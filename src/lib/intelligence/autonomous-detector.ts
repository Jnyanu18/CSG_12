import { connectToDatabase } from '@/lib/mongodb';
import Interaction from '@/lib/db/models/Interaction';
import mongoose from 'mongoose';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AutonomousError {
  interactionId: string;
  filename: string;
  predictedCount: number;
  confidence: string;
  signals: string[];
  errorScore: number;
  imageMetadata: object;
}

export interface AutonomousDetectionResult {
  totalAnalyzed: number;
  suspectedErrors: number;
  errorRate: number;

  bySignal: {
    uncertainty: { flagged: number; examples: AutonomousError[] };
    inconsistency: { flagged: number; examples: AutonomousError[] };
    physicalConstraint: { flagged: number; examples: AutonomousError[] };
  };

  combinedErrors: AutonomousError[];

  discoveredPatterns: {
    feature: string;
    avgWhenSuspected: number;
    avgWhenTrusted: number;
    difference: number;
    interpretation: string;
  }[];

  comparedToGroundTruth: {
    truePositives: number;
    falsePositives: number;
    precision: number;
    recall: number;
    note: string;
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function avg(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function getNum(obj: unknown, key: string): number | null {
  if (obj && typeof obj === 'object') {
    const v = (obj as Record<string, unknown>)[key];
    if (typeof v === 'number') return v;
  }
  return null;
}

// ── Main ───────────────────────────────────────────────────────────────────────

export async function detectErrorsAutonomously(): Promise<AutonomousDetectionResult> {
  await connectToDatabase();

  // Step 1 — Load all plant-analysis interactions with a fruitCount
  const raw = await Interaction.find({ flowType: 'plant-analysis' }).lean();

  const interactions = raw.filter(i => {
    const fc = getNum(i.geminiOutput, 'fruitCount');
    return fc !== null;
  });

  const totalAnalyzed = interactions.length;

  // Build per-filename groups for Signal 2
  const byFilename = new Map<string, Array<{ id: string; count: number }>>();
  for (const i of interactions) {
    const filename = String((i.inputData as Record<string, unknown>)?.filename ?? '');
    const count = getNum(i.geminiOutput, 'fruitCount') ?? 0;
    if (!filename) continue;
    if (!byFilename.has(filename)) byFilename.set(filename, []);
    byFilename.get(filename)!.push({ id: String(i._id), count });
  }

  // Build per-user ordered lists for Signal 3
  const byUser = new Map<string, Array<{ id: string; count: number; ts: number }>>();
  for (const i of interactions) {
    const uid = i.userId;
    const count = getNum(i.geminiOutput, 'fruitCount') ?? 0;
    const ts = i.createdAt instanceof Date ? i.createdAt.getTime() : 0;
    if (!byUser.has(uid)) byUser.set(uid, []);
    byUser.get(uid)!.push({ id: String(i._id), count, ts });
  }
  for (const list of byUser.values()) {
    list.sort((a, b) => a.ts - b.ts);
  }

  // Pre-compute inconsistency scores per id
  const inconsistencyScoreById = new Map<string, number>();
  for (const [, group] of byFilename) {
    if (group.length < 2) continue;
    const counts = group.map(g => g.count);
    const variance = Math.max(...counts) - Math.min(...counts);
    const score = variance > 3 ? 1.0 : variance >= 1 ? 0.4 : 0;
    if (score > 0) {
      for (const g of group) inconsistencyScoreById.set(g.id, score);
    }
  }

  // Pre-compute growth-constraint violations per id
  const constraintScoreById = new Map<string, number>();
  for (const [, list] of byUser) {
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1].count;
      const curr = list[i].count;
      if (prev > 0 && (prev - curr) / prev > 0.4) {
        constraintScoreById.set(list[i].id, 1.0);
      }
    }
  }

  // Step 2 — Score every interaction
  const scored: (AutonomousError & { classification: 'suspected_error' | 'suspicious' | 'trusted' })[] = [];

  for (const i of interactions) {
    const id = String(i._id);
    const filename = String((i.inputData as Record<string, unknown>)?.filename ?? '');
    const predictedCount = getNum(i.geminiOutput, 'fruitCount') ?? 0;
    const confidence = i.confidence ?? 'medium';
    const signals: string[] = [];
    let errorScore = 0;

    // Signal 1 — Uncertainty
    if (confidence === 'low') {
      errorScore += 1.0;
      signals.push('low_confidence');
    } else if (confidence === 'medium') {
      errorScore += 0.4;
      signals.push('low_confidence');
    }

    // Signal 2 — Inconsistency
    const incScore = inconsistencyScoreById.get(id) ?? 0;
    if (incScore > 0) {
      errorScore += incScore;
      signals.push('inconsistent_predictions');
    }

    // Signal 3 — Physical constraint
    const conScore = constraintScoreById.get(id) ?? 0;
    if (conScore > 0) {
      errorScore += conScore;
      signals.push('violates_growth_constraint');
    }

    const classification =
      errorScore >= 1.5 ? 'suspected_error' :
      errorScore >= 0.5 ? 'suspicious' :
      'trusted';

    scored.push({
      interactionId: id,
      filename,
      predictedCount,
      confidence,
      signals,
      errorScore,
      imageMetadata: (i.imageMetadata ?? {}) as object,
      classification,
    });
  }

  // Step 3 — bySignal counts
  const uncertaintyFlagged = scored.filter(s => s.signals.includes('low_confidence'));
  const inconsistencyFlagged = scored.filter(s => s.signals.includes('inconsistent_predictions'));
  const constraintFlagged = scored.filter(s => s.signals.includes('violates_growth_constraint'));

  const combinedErrors = scored
    .filter(s => s.classification === 'suspected_error')
    .sort((a, b) => b.errorScore - a.errorScore);

  // Step 4 — Discover patterns autonomously
  const suspected = scored.filter(s => s.errorScore >= 1.0);
  const trusted = scored.filter(s => s.errorScore < 0.5);

  const metaFields: { key: string; label: string }[] = [
    { key: 'brightnessScore', label: 'Brightness Score' },
    { key: 'estimatedOcclusion', label: 'Estimated Occlusion' },
    { key: 'imageSharpness', label: 'Image Sharpness' },
  ];

  const discoveredPatterns = metaFields
    .map(({ key, label }) => {
      const suspectedVals = suspected
        .map(s => getNum(s.imageMetadata, key))
        .filter((v): v is number => v !== null);
      const trustedVals = trusted
        .map(s => getNum(s.imageMetadata, key))
        .filter((v): v is number => v !== null);

      if (!suspectedVals.length && !trustedVals.length) return null;

      const avgSuspected = avg(suspectedVals);
      const avgTrusted = avg(trustedVals);
      const difference = avgSuspected - avgTrusted;

      let interpretation = '';
      if (key === 'estimatedOcclusion') {
        interpretation = difference > 0
          ? `Higher occlusion in suspected errors (+${difference.toFixed(2)}) — obstructed views increase error risk`
          : `Occlusion similar between groups`;
      } else if (key === 'brightnessScore') {
        interpretation = Math.abs(difference) > 0.05
          ? `Brightness differs by ${difference.toFixed(2)} — lighting conditions correlate with errors`
          : `Brightness consistent across groups`;
      } else if (key === 'imageSharpness') {
        interpretation = difference < 0
          ? `Lower sharpness in suspected errors (${difference.toFixed(2)}) — blurry images drive uncertainty`
          : `Sharpness similar between groups`;
      }

      return { feature: label, avgWhenSuspected: avgSuspected, avgWhenTrusted: avgTrusted, difference, interpretation };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  // fruitCount pattern
  const suspectedCounts = suspected.map(s => s.predictedCount);
  const trustedCounts = trusted.map(s => s.predictedCount);
  if (suspectedCounts.length && trustedCounts.length) {
    const avgSuspected = avg(suspectedCounts);
    const avgTrusted = avg(trustedCounts);
    discoveredPatterns.push({
      feature: 'Fruit Count (prediction)',
      avgWhenSuspected: avgSuspected,
      avgWhenTrusted: avgTrusted,
      difference: avgSuspected - avgTrusted,
      interpretation: avgSuspected > avgTrusted
        ? `Higher counts in suspected errors — dense scenes correlate with detection uncertainty`
        : `Higher counts in trusted predictions — low counts are more reliably detected`,
    });
  }

  discoveredPatterns.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));

  // Step 5 — Validate against ground truth
  const withGroundTruth = interactions.filter(i => {
    const actual = (i.actualOutcome as Record<string, unknown> | undefined)?.actualValue;
    return typeof actual === 'number';
  });

  let truePositives = 0;
  let falsePositives = 0;
  let totalRealErrors = 0;

  for (const i of withGroundTruth) {
    const id = String(i._id);
    const predicted = getNum(i.geminiOutput, 'fruitCount') ?? 0;
    const actual = ((i.actualOutcome as unknown as Record<string, unknown>).actualValue) as number;
    const isRealError = Math.abs(predicted - actual) > 1;
    const scoredEntry = scored.find(s => s.interactionId === id);
    const wasFlagged = (scoredEntry?.errorScore ?? 0) >= 1.0;

    if (isRealError) totalRealErrors++;
    if (wasFlagged && isRealError) truePositives++;
    if (wasFlagged && !isRealError) falsePositives++;
  }

  const totalFlagged = combinedErrors.length;
  const precision = totalFlagged > 0 ? truePositives / totalFlagged : 0;
  const recall = totalRealErrors > 0 ? truePositives / totalRealErrors : 0;
  const recallPct = Math.round(recall * 100);

  // Step 6 — Save to MongoDB
  const db = mongoose.connection.db;
  if (db) {
    const result: AutonomousDetectionResult = {
      totalAnalyzed,
      suspectedErrors: combinedErrors.length,
      errorRate: totalAnalyzed > 0 ? combinedErrors.length / totalAnalyzed : 0,
      bySignal: {
        uncertainty: { flagged: uncertaintyFlagged.length, examples: uncertaintyFlagged.slice(0, 3) },
        inconsistency: { flagged: inconsistencyFlagged.length, examples: inconsistencyFlagged.slice(0, 3) },
        physicalConstraint: { flagged: constraintFlagged.length, examples: constraintFlagged.slice(0, 3) },
      },
      combinedErrors: combinedErrors.slice(0, 20),
      discoveredPatterns,
      comparedToGroundTruth: {
        truePositives,
        falsePositives,
        precision,
        recall,
        note: withGroundTruth.length > 0
          ? `Engine detected ${recallPct}% of real errors without any human feedback (${withGroundTruth.length} interactions had ground truth)`
          : `No ground truth available yet — run against labeled data to measure recall`,
      },
    };

    await db.collection('autonomous_detections').insertOne({
      ...result,
      runAt: new Date(),
    });

    return result;
  }

  return {
    totalAnalyzed,
    suspectedErrors: combinedErrors.length,
    errorRate: totalAnalyzed > 0 ? combinedErrors.length / totalAnalyzed : 0,
    bySignal: {
      uncertainty: { flagged: uncertaintyFlagged.length, examples: uncertaintyFlagged.slice(0, 3) },
      inconsistency: { flagged: inconsistencyFlagged.length, examples: inconsistencyFlagged.slice(0, 3) },
      physicalConstraint: { flagged: constraintFlagged.length, examples: constraintFlagged.slice(0, 3) },
    },
    combinedErrors: combinedErrors.slice(0, 20),
    discoveredPatterns,
    comparedToGroundTruth: {
      truePositives,
      falsePositives,
      precision,
      recall,
      note: `No ground truth available yet — run against labeled data to measure recall`,
    },
  };
}
