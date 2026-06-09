import { connectToDatabase } from '@/lib/mongodb';
import Interaction from '@/lib/db/models/Interaction';
import DomainPattern from '@/lib/db/models/DomainPattern';

const MIN_CORRECTIONS = 5;

// Hours considered low-light / poor-image-quality window
const EVENING_HOURS = new Set([18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6]);

type PatternDoc = {
  flowType: 'plant-analysis' | 'yield-forecast';
  patternType: 'time_based' | 'systematic_bias' | 'confidence_unreliable';
  pattern: string;
  insight: string;
  condition?: string;
  metadata: Record<string, unknown>;
  extractedAt: Date;
  interactionsAnalyzed: number;
  active: boolean;
};

export async function extractDomainPatterns(): Promise<PatternDoc[]> {
  await connectToDatabase();

  // Fetch all corrected interactions for the two supported flows
  const corrected = await Interaction.find({
    flowType: { $in: ['plant-analysis', 'yield-forecast'] },
    'farmerCorrection.correctedValue': { $exists: true, $ne: null },
  }).lean();

  if (corrected.length < MIN_CORRECTIONS) return [];

  // Fetch all interactions for denominator calculations (Patterns A and C)
  const all = await Interaction.find({
    flowType: { $in: ['plant-analysis', 'yield-forecast'] },
  }).lean();

  const extracted: PatternDoc[] = [];
  const now = new Date();

  // ── Pattern A: Time-based failures ─────────────────────────────────────────
  // Build per-hour totals across all interactions and per-hour correction counts
  const hourTotals: Record<number, number> = {};
  for (const doc of all) {
    const h = new Date(doc.timestamp).getHours();
    hourTotals[h] = (hourTotals[h] ?? 0) + 1;
  }

  const hourCorrections: Record<number, number> = {};
  for (const doc of corrected) {
    const h = new Date(doc.timestamp).getHours();
    hourCorrections[h] = (hourCorrections[h] ?? 0) + 1;
  }

  const eveningTotal     = [...EVENING_HOURS].reduce((s, h) => s + (hourTotals[h] ?? 0), 0);
  const eveningCorrected = [...EVENING_HOURS].reduce((s, h) => s + (hourCorrections[h] ?? 0), 0);
  const eveningRate      = eveningTotal > 0 ? eveningCorrected / eveningTotal : 0;

  if (eveningRate > 0.5) {
    const pct = Math.round(eveningRate * 100);
    extracted.push({
      flowType:             'plant-analysis',
      patternType:          'time_based',
      pattern:              'evening_images_unreliable',
      condition:            'hour >= 18 OR hour <= 6',
      insight:              `Evening and early-morning images fail ${pct}% of the time. Request the farmer to retake photos in daylight (7 am–6 pm) for reliable results.`,
      metadata:             { eveningRate, eveningCorrected, eveningTotal },
      extractedAt:          now,
      interactionsAnalyzed: all.length,
      active:               true,
    });
  }

  // ── Pattern B: Systematic undercounting (plant-analysis only) ──────────────
  const plantCorrected = corrected.filter(d => d.flowType === 'plant-analysis');
  const deltas: number[] = [];

  for (const doc of plantCorrected) {
    const raw = doc.farmerCorrection?.correctedValue;
    const correctedCount =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string'
        ? parseFloat(raw)
        : NaN;
    if (isNaN(correctedCount)) continue;

    const output = doc.geminiOutput as { stages?: Array<{ stage: string; count: number }> };
    const aiCount = (output.stages ?? []).reduce((s, st) => s + (st.count ?? 0), 0);
    deltas.push(correctedCount - aiCount);
  }

  if (deltas.length >= MIN_CORRECTIONS) {
    const avgDelta     = deltas.reduce((s, d) => s + d, 0) / deltas.length;
    const consistentUp = deltas.filter(d => d > 0).length / deltas.length >= 0.7;

    if (consistentUp && avgDelta > 0) {
      const rounded = Math.round(avgDelta);
      extracted.push({
        flowType:             'plant-analysis',
        patternType:          'systematic_bias',
        pattern:              'undercounting_bias',
        insight:              `This model consistently undercounts fruits by an average of ${rounded} per image. Add ${rounded} to the raw detected count when presenting results to this farmer.`,
        metadata:             { averageDelta: Math.round(avgDelta * 100) / 100, sampleSize: deltas.length },
        extractedAt:          now,
        interactionsAnalyzed: plantCorrected.length,
        active:               true,
      });
    }
  }

  // ── Pattern C: High-confidence unreliability (both flows) ──────────────────
  for (const flowType of ['plant-analysis', 'yield-forecast'] as const) {
    const highConfAll       = all.filter(d => d.flowType === flowType && d.confidence === 'high');
    const highConfCorrected = corrected.filter(d => d.flowType === flowType && d.confidence === 'high');

    if (highConfAll.length < MIN_CORRECTIONS) continue;

    const falseRate = highConfCorrected.length / highConfAll.length;
    if (falseRate > 0.3) {
      const pct = Math.round(falseRate * 100);
      extracted.push({
        flowType,
        patternType:          'confidence_unreliable',
        pattern:              'high_confidence_still_wrong',
        insight:              `High-confidence predictions for ${flowType} are still corrected by farmers ${pct}% of the time. Treat high confidence as medium and always show the correction option regardless of confidence level.`,
        metadata:             {
          falseConfidenceRate: Math.round(falseRate * 100) / 100,
          highConfTotal:       highConfAll.length,
          highConfCorrected:   highConfCorrected.length,
        },
        extractedAt:          now,
        interactionsAnalyzed: highConfAll.length,
        active:               true,
      });
    }
  }

  if (extracted.length === 0) return [];

  // Deactivate existing patterns for the affected flow types, then insert fresh ones
  const affectedFlowTypes = [...new Set(extracted.map(p => p.flowType))];
  await DomainPattern.updateMany(
    { flowType: { $in: affectedFlowTypes }, active: true },
    { $set: { active: false } }
  );
  await DomainPattern.insertMany(extracted);

  return extracted;
}
