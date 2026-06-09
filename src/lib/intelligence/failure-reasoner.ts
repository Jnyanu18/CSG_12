import { connectToDatabase } from '@/lib/mongodb';
import ValidatedCorrection from '@/lib/db/models/ValidatedCorrection';

// ── Types ─────────────────────────────────────────────────────────────────────

export type FailureCause =
  | 'systematic_bias'
  | 'confidence_miscalibration'
  | 'data_gap'
  | 'temporal_drift'
  | 'poor_input_quality'
  | 'distribution_shift'
  | 'domain_uncertainty'
  | 'high_occlusion'
  | 'poor_brightness'
  | 'image_blur'
  | 'background_noise'
  | 'angle_occlusion_combined'
  | 'unknown';

export interface FailureClassification {
  primaryCause: FailureCause;
  secondaryCause?: FailureCause;
  confidence: number;
  explanation: string;
  features: Record<string, unknown>;
}

export interface FailureReportEntry {
  cause: FailureCause;
  count: number;
  avgDeltaPercent: number;
  examples: string[];
}

export interface FailureReport {
  flowType: string;
  days: number;
  totalCorrections: number;
  breakdown: FailureReportEntry[];
  generatedAt: Date;
}

export interface FeedbackReport {
  generatedAt: string;
  summary: string;
  flowBreakdowns: FailureReport[];
  humanReadable: string;
}

// ── Cause scoring ─────────────────────────────────────────────────────────────

function scoreAllCauses(
  interaction: Record<string, unknown>,
  correction: Record<string, unknown>,
): Map<FailureCause, number> {
  const scores = new Map<FailureCause, number>();

  const deltaPercent   = Math.abs((correction.deltaPercent as number) ?? 0);
  const delta          = (correction.delta as number) ?? 0;
  const confidence     = (correction.conditions as Record<string, unknown>)?.confidence as string ?? 'medium';
  const uncertaintyType = (correction.conditions as Record<string, unknown>)?.uncertaintyType as string ?? 'model';
  const hourOfDay      = (correction.conditions as Record<string, unknown>)?.hourOfDay as number ?? 12;
  const similarCorrections = (correction.validation as Record<string, unknown>)?.similarCorrections as number ?? 0;
  const consistencyScore   = (correction.validation as Record<string, unknown>)?.consistencyScore as number ?? 0;
  const flowType       = correction.flowType as string ?? '';
  const cropType       = correction.cropType as string ?? '';

  const imageMeta = interaction.imageMetadata as Record<string, unknown> | undefined;
  const estimatedOcclusion = typeof imageMeta?.estimatedOcclusion === 'number' ? imageMeta.estimatedOcclusion : undefined;
  const brightnessScore    = typeof imageMeta?.brightnessScore    === 'number' ? imageMeta.brightnessScore    : undefined;
  const imageSharpness     = typeof imageMeta?.imageSharpness     === 'number' ? imageMeta.imageSharpness     : undefined;
  const backgroundClutter  = typeof imageMeta?.backgroundClutter  === 'string' ? imageMeta.backgroundClutter  : undefined;
  const imagingAngle       = typeof imageMeta?.imagingAngle       === 'string' ? imageMeta.imagingAngle       : undefined;

  // systematic_bias — consistent directional error with high consistency score
  {
    let s = 0;
    if (consistencyScore >= 0.7) s += 0.5;
    if (similarCorrections >= 5) s += 0.3;
    if (deltaPercent >= 10 && deltaPercent < 50) s += 0.2;
    scores.set('systematic_bias', Math.min(s, 1));
  }

  // confidence_miscalibration — high confidence but significantly wrong
  {
    let s = 0;
    if (confidence === 'high' && deltaPercent >= 15) s += 0.6;
    else if (confidence === 'high' && deltaPercent >= 10) s += 0.4;
    if (uncertaintyType === 'model') s += 0.2;
    if (deltaPercent >= 20) s += 0.2;
    scores.set('confidence_miscalibration', Math.min(s, 1));
  }

  // data_gap — few similar corrections exist, model hasn't seen this before
  {
    let s = 0;
    if (similarCorrections === 0) s += 0.6;
    else if (similarCorrections <= 2) s += 0.35;
    if (consistencyScore < 0.3) s += 0.25;
    if (cropType && cropType !== 'unknown') s += 0.15;
    scores.set('data_gap', Math.min(s, 1));
  }

  // temporal_drift — market price flow where price data can go stale
  {
    let s = 0;
    if (flowType === 'market-price') {
      s += 0.5;
      if (deltaPercent >= 20) s += 0.3;
      if (delta < 0) s += 0.2;
    }
    scores.set('temporal_drift', Math.min(s, 1));
  }

  // poor_input_quality — evening/night + plant analysis (image degrades)
  {
    let s = 0;
    if (flowType === 'plant-analysis') {
      if (hourOfDay >= 18 || hourOfDay <= 6) s += 0.5;
      else if (hourOfDay >= 16 || hourOfDay <= 8) s += 0.25;
      if (uncertaintyType === 'data') s += 0.3;
      if (deltaPercent >= 25) s += 0.2;
    }
    scores.set('poor_input_quality', Math.min(s, 1));
  }

  // distribution_shift — error far outside expected range (> 50% off)
  {
    let s = 0;
    if (deltaPercent >= 50) s += 0.7;
    else if (deltaPercent >= 35) s += 0.4;
    if (similarCorrections >= 3 && consistencyScore < 0.4) s += 0.3;
    scores.set('distribution_shift', Math.min(s, 1));
  }

  // domain_uncertainty — AI explicitly flagged uncertainty and was wrong
  {
    let s = 0;
    if (confidence === 'low') s += 0.4;
    if (uncertaintyType === 'domain') s += 0.4;
    if (deltaPercent >= 10) s += 0.2;
    scores.set('domain_uncertainty', Math.min(s, 1));
  }

  // high_occlusion — more than half of fruits blocked from view
  {
    const s = (flowType === 'plant-analysis' && estimatedOcclusion !== undefined && estimatedOcclusion > 0.5) ? 0.8 : 0;
    scores.set('high_occlusion', s);
  }

  // poor_brightness — image too dark for reliable detection
  {
    const s = (flowType === 'plant-analysis' && brightnessScore !== undefined && brightnessScore < 0.3) ? 0.8 : 0;
    scores.set('poor_brightness', s);
  }

  // image_blur — insufficient sharpness for fruit detection
  {
    const s = (flowType === 'plant-analysis' && imageSharpness !== undefined && imageSharpness < 0.4) ? 0.8 : 0;
    scores.set('image_blur', s);
  }

  // background_noise — busy background confuses detection
  {
    const s = (flowType === 'plant-analysis' && backgroundClutter === 'high') ? 0.7 : 0;
    scores.set('background_noise', s);
  }

  // angle_occlusion_combined — side angle with significant occlusion causes systematic undercounting
  {
    const s = (
      flowType === 'plant-analysis' &&
      imagingAngle === 'side' &&
      estimatedOcclusion !== undefined &&
      estimatedOcclusion > 0.3
    ) ? 0.9 : 0;
    scores.set('angle_occlusion_combined', s);
  }

  scores.set('unknown', 0.01);

  return scores;
}

function causeExplanation(cause: FailureCause, deltaPercent: number, flowType: string): string {
  const pct = deltaPercent.toFixed(1);
  switch (cause) {
    case 'systematic_bias':
      return `The AI consistently errs in the same direction for this crop/condition (${pct}% off). Historical corrections show a repeating pattern.`;
    case 'confidence_miscalibration':
      return `The AI reported high confidence but was ${pct}% wrong. The model's confidence signals are not calibrated for this input type.`;
    case 'data_gap':
      return `Few or no similar corrections exist for this crop/condition. The model lacks sufficient domain-specific examples to predict accurately.`;
    case 'temporal_drift':
      return `Market price data may be stale or the market moved significantly since the model's last effective update (${pct}% deviation).`;
    case 'poor_input_quality':
      return `Low-light or off-peak conditions likely degraded input image quality, reducing prediction reliability (${pct}% off).`;
    case 'distribution_shift':
      return `The prediction was ${pct}% off — far outside the expected error distribution. The input may represent an edge case the model has never encountered.`;
    case 'domain_uncertainty':
      return `The AI flagged uncertainty for this domain and was confirmed to be incorrect by ${pct}%. Domain-specific knowledge is insufficient.`;
    case 'high_occlusion':
      return `More than 50% of fruits blocked from view. Occlusion is primary failure driver.`;
    case 'poor_brightness':
      return `Image too dark for reliable detection. Retake in better lighting.`;
    case 'image_blur':
      return `Image not sharp enough. Hold camera steady or move closer.`;
    case 'background_noise':
      return `Busy background confuses fruit detection. Try plain background.`;
    case 'angle_occlusion_combined':
      return `Side angle with occlusion causes systematic undercounting. Retake from above.`;
    default:
      return `Failure cause could not be determined with confidence. Error magnitude: ${pct}%.`;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function classifyFailureCause(
  interaction: Record<string, unknown>,
  correction: Record<string, unknown>,
): FailureClassification {
  const scores = scoreAllCauses(interaction, correction);

  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const [topCause, topScore]       = sorted[0];
  const [secondCause, secondScore] = sorted[1] ?? ['unknown', 0];

  const primaryCause   = topScore > 0 ? topCause : 'unknown';
  const secondaryCause = secondScore >= 0.4 && secondCause !== primaryCause
    ? secondCause
    : undefined;

  const deltaPercent = Math.abs((correction.deltaPercent as number) ?? 0);
  const flowType     = correction.flowType as string ?? '';

  const features: Record<string, unknown> = {
    deltaPercent,
    delta:          correction.delta,
    confidence:     (correction.conditions as Record<string, unknown>)?.confidence,
    uncertaintyType:(correction.conditions as Record<string, unknown>)?.uncertaintyType,
    hourOfDay:      (correction.conditions as Record<string, unknown>)?.hourOfDay,
    similarCorrections: (correction.validation as Record<string, unknown>)?.similarCorrections,
    consistencyScore:   (correction.validation as Record<string, unknown>)?.consistencyScore,
    flowType,
    cropType: correction.cropType,
    allScores: Object.fromEntries(scores),
  };

  return {
    primaryCause,
    secondaryCause,
    confidence: Math.round(topScore * 100) / 100,
    explanation: causeExplanation(primaryCause, deltaPercent, flowType),
    features,
  };
}

export async function generateFailureReport(
  flowType: string,
  days = 30,
): Promise<FailureReport> {
  await connectToDatabase();

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const docs = await ValidatedCorrection.find({
    flowType,
    createdAt: { $gte: since },
    'failureReason.primaryCause': { $exists: true },
  })
    .select('failureReason deltaPercent _id')
    .lean();

  const totalCorrections = docs.length;

  const grouped = new Map<FailureCause, { deltas: number[]; ids: string[] }>();

  for (const doc of docs) {
    const cause = doc.failureReason?.primaryCause as FailureCause | undefined;
    if (!cause) continue;
    if (!grouped.has(cause)) grouped.set(cause, { deltas: [], ids: [] });
    const entry = grouped.get(cause)!;
    entry.deltas.push(Math.abs(doc.deltaPercent ?? 0));
    entry.ids.push(doc._id.toString());
  }

  const breakdown: FailureReportEntry[] = [];
  for (const [cause, { deltas, ids }] of grouped.entries()) {
    const avg = deltas.length > 0
      ? Math.round((deltas.reduce((a, b) => a + b, 0) / deltas.length) * 100) / 100
      : 0;
    breakdown.push({
      cause,
      count: deltas.length,
      avgDeltaPercent: avg,
      examples: ids.slice(0, 3),
    });
  }

  breakdown.sort((a, b) => b.count - a.count);

  return { flowType, days, totalCorrections, breakdown, generatedAt: new Date() };
}

export async function generateFeedbackReport(): Promise<FeedbackReport> {
  await connectToDatabase();

  const flowTypes = ['yield-forecast', 'plant-analysis', 'market-price'] as const;

  const flowBreakdowns = await Promise.all(
    flowTypes.map(ft => generateFailureReport(ft, 30)),
  );

  const totalCorrections = flowBreakdowns.reduce((s, r) => s + r.totalCorrections, 0);

  const causeGlobal = new Map<FailureCause, number>();
  for (const report of flowBreakdowns) {
    for (const entry of report.breakdown) {
      causeGlobal.set(entry.cause, (causeGlobal.get(entry.cause) ?? 0) + entry.count);
    }
  }

  const topCauses = [...causeGlobal.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cause, count]) => `${cause} (${count})`);

  const summary = totalCorrections === 0
    ? 'No farmer corrections with failure classifications recorded in the last 30 days.'
    : `In the last 30 days, ${totalCorrections} farmer corrections were classified. ` +
      `Top failure causes: ${topCauses.join(', ')}.`;

  const lines: string[] = [
    '=== Tree Nexus — Failure Reasoning Report ===',
    `Generated: ${new Date().toISOString()}`,
    '',
    summary,
    '',
  ];

  for (const report of flowBreakdowns) {
    if (report.totalCorrections === 0) continue;
    lines.push(`--- Flow: ${report.flowType} (${report.totalCorrections} corrections) ---`);
    for (const entry of report.breakdown) {
      lines.push(
        `  ${entry.cause}: ${entry.count} cases, avg error ${entry.avgDeltaPercent}%`,
      );
    }
    lines.push('');
  }

  lines.push('=== Recommendations ===');
  if ((causeGlobal.get('systematic_bias') ?? 0) > 2) {
    lines.push('• systematic_bias detected — consider updating domain patterns or retraining on recent corrections.');
  }
  if ((causeGlobal.get('confidence_miscalibration') ?? 0) > 2) {
    lines.push('• confidence_miscalibration — prompt should instruct model to lower confidence when extrapolating.');
  }
  if ((causeGlobal.get('data_gap') ?? 0) > 2) {
    lines.push('• data_gap — more labeled examples needed for underrepresented crops/conditions.');
  }
  if ((causeGlobal.get('poor_input_quality') ?? 0) > 2) {
    lines.push('• poor_input_quality — add UI warning when user submits after sunset.');
  }

  return {
    generatedAt: new Date().toISOString(),
    summary,
    flowBreakdowns,
    humanReadable: lines.join('\n'),
  };
}
