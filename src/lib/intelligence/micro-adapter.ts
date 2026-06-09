import { connectToDatabase } from '@/lib/mongodb';
import MicroAdapter, { IMicroAdapter } from '@/lib/db/models/MicroAdapter';
import DomainPattern from '@/lib/db/models/DomainPattern';
import { getTrainingReadyCorrections, markAsUsedInTraining } from '@/lib/db/validatedCorrections';
import type { IValidatedCorrection } from '@/lib/db/models/ValidatedCorrection';
import { randomUUID } from 'crypto';

// Flows that support numerical adapter calibration
const NUMERICAL_FLOWS = new Set(['yield-forecast', 'plant-analysis', 'market-price']);

type TimeWindow = 'morning' | 'afternoon' | 'evening' | 'night';

export type ImageConditions = {
  estimatedOcclusion?: number;
  brightnessScore?: number;
  imageSharpness?: number;
};

type ApplyAdapterResult = {
  rawPrediction: number;
  adjustedPrediction: number;
  adapterApplied: boolean;
  adapterId: string;
  multiplier: number;
  finalMultiplier: number;
  trainingSize: number;
  calibrationSource: 'time_specific' | 'overall';
  conditionAdjustment: 'amplified' | 'reduced' | 'standard';
  explanation: string;
};

function getTimeWindow(hour: number): TimeWindow {
  if (hour >= 6  && hour <= 11) return 'morning';
  if (hour >= 12 && hour <= 17) return 'afternoon';
  if (hour >= 18 && hour <= 23) return 'evening';
  return 'night';
}

function getMagnitude(absPercent: number): 'small' | 'medium' | 'large' {
  if (absPercent < 10)  return 'small';
  if (absPercent < 25)  return 'medium';
  return 'large';
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION 2 (internal) — build and persist the adapter
// ─────────────────────────────────────────────────────────────────────────────
async function buildMicroAdapter(
  flowType: string,
  corrections: IValidatedCorrection[]
): Promise<IMicroAdapter> {
  await connectToDatabase();

  const trainingSize = corrections.length;

  // ── Step 1: Extract learning signal ────────────────────────────────────────

  // Use the stored deltaPercent values (same formula as spec)
  const allDeltas = corrections.map(c => c.deltaPercent);

  const overallAvg =
    Math.round((allDeltas.reduce((s, d) => s + d, 0) / allDeltas.length) * 100) / 100;

  // Group by time window
  const groups: Record<TimeWindow, number[]> = {
    morning: [], afternoon: [], evening: [], night: [],
  };

  for (const c of corrections) {
    const window = getTimeWindow(c.conditions.hourOfDay);
    groups[window].push(c.deltaPercent);
  }

  const timeCalibrations = (Object.entries(groups) as [TimeWindow, number[]][]).map(
    ([timeWindow, deltas]) => {
      const avg = deltas.length > 0
        ? Math.round((deltas.reduce((s, d) => s + d, 0) / deltas.length) * 100) / 100
        : 0;
      return {
        timeWindow,
        averageDeltaPercent: avg,
        sampleSize: deltas.length,
        active: deltas.length >= 3,
      };
    }
  );

  // ── Step 2: Build adapter rules ────────────────────────────────────────────

  const multiplier = Math.round((1 + overallAvg / 100) * 10000) / 10000;

  const overallCalibration = {
    averageDeltaPercent: overallAvg,
    direction: (overallAvg > 0 ? 'underestimate' : 'overestimate') as 'overestimate' | 'underestimate',
    magnitude: getMagnitude(Math.abs(overallAvg)),
  };

  const calibrationFunction = {
    formula: `rawPrediction × ${multiplier} (adjustment: ${overallAvg > 0 ? '+' : ''}${overallAvg}%)`,
    multiplier,
  };

  const validationScore =
    corrections.reduce((s, c) => s + (c.validation?.confidenceScore ?? 0), 0) / trainingSize;

  // ── Step 3: Get next version and deactivate old adapters ───────────────────

  const batchId  = randomUUID();
  const builtAt  = new Date();

  // Use highest version across all statuses for monotonic versioning
  const latestAdapter = await MicroAdapter.findOne({ flowType })
    .sort({ version: -1 })
    .lean();

  const version = latestAdapter ? latestAdapter.version + 1 : 1;

  // ── Step 3 continued: Save new adapter as pending_validation ──────────────
  // The self-validator promotes to 'active' once post-adapter outcomes confirm improvement.
  // Any currently active adapter keeps running until the new one is validated.

  const adapter = await MicroAdapter.create({
    flowType,
    batchId,
    version,
    builtAt,
    trainingSize,
    overallCalibration,
    timeCalibrations,
    calibrationFunction,
    validationScore: Math.round(validationScore * 100) / 100,
    status: 'pending_validation',
  });

  console.log(
    `[micro-adapter] Built v${version} adapter for '${flowType}' (pending_validation): ` +
    `multiplier=${multiplier}, trainingSize=${trainingSize}, ` +
    `direction=${overallCalibration.direction}, magnitude=${overallCalibration.magnitude}`
  );

  // ── Step 4: Mark corrections as used ──────────────────────────────────────

  const ids = corrections.map(c => (c._id as { toString(): string }).toString());
  await markAsUsedInTraining(ids, batchId);

  // ── Step 5: Save as domain pattern ────────────────────────────────────────

  // Deactivate any existing calibration_adapter patterns for this flowType.
  // Cast to `any` because 'calibration_adapter' is not in IDomainPattern's patternType union,
  // but the Mongoose schema itself uses { type: String } with no enum validation.
  await DomainPattern.updateMany(
    { flowType, patternType: 'calibration_adapter', active: true } as any,
    { $set: { active: false } }
  );

  await DomainPattern.create({
    flowType:    flowType as 'plant-analysis' | 'yield-forecast',
    patternType: 'calibration_adapter' as any,
    pattern:     `micro_adapter_v${version}`,
    insight:
      `AI predictions for ${flowType} are adjusted by ${multiplier}x ` +
      `based on ${trainingSize} validated farmer corrections. ` +
      `The model ${overallCalibration.direction}s by ${Math.abs(overallAvg).toFixed(1)}% on average.`,
    metadata:             { adapterId: batchId, multiplier, version },
    extractedAt:          builtAt,
    interactionsAnalyzed: trainingSize,
    active:               true,
  } as any);

  return adapter;
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION 1 — check threshold and trigger training
// ─────────────────────────────────────────────────────────────────────────────
export async function checkAndTriggerAdapterTraining(flowType: string): Promise<{
  triggered: boolean;
  adapter?: IMicroAdapter;
  trainingSize?: number;
  calibrationMultiplier?: number;
}> {
  try {
    const { ready, corrections } = await getTrainingReadyCorrections(flowType);

    if (!ready) return { triggered: false };

    const adapter = await buildMicroAdapter(flowType, corrections);
    return {
      triggered: true,
      adapter,
      trainingSize:          adapter.trainingSize,
      calibrationMultiplier: adapter.calibrationFunction.multiplier,
    };
  } catch (err) {
    console.error(`[micro-adapter] checkAndTriggerAdapterTraining failed for '${flowType}':`, err);
    return { triggered: false };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION 3 — apply the active adapter to a raw prediction
// ─────────────────────────────────────────────────────────────────────────────
export async function applyMicroAdapter(
  flowType: string,
  rawPrediction: number,
  imageConditions?: ImageConditions
): Promise<ApplyAdapterResult> {
  const noAdapter: ApplyAdapterResult = {
    rawPrediction,
    adjustedPrediction: rawPrediction,
    adapterApplied: false,
    adapterId: '',
    multiplier: 1,
    finalMultiplier: 1,
    trainingSize: 0,
    calibrationSource: 'overall',
    conditionAdjustment: 'standard',
    explanation: `No active adapter found for '${flowType}'.`,
  };

  // Never apply to chat-assistant
  if (!NUMERICAL_FLOWS.has(flowType)) return noAdapter;

  try {
    await connectToDatabase();

    const adapter = await MicroAdapter.findOne({ flowType, status: 'active' })
      .sort({ builtAt: -1 })
      .lean();

    if (!adapter) {
      console.log(`[micro-adapter] No active adapter for '${flowType}' — returning raw prediction.`);
      return noAdapter;
    }

    const currentHour = new Date().getHours();
    const currentWindow = getTimeWindow(currentHour);

    // Check for an active time-specific calibration
    const timeCalib = adapter.timeCalibrations.find(
      tc => tc.timeWindow === currentWindow && tc.active
    );

    let multiplier: number;
    let calibrationSource: 'time_specific' | 'overall';

    if (timeCalib) {
      multiplier = Math.round((1 + timeCalib.averageDeltaPercent / 100) * 10000) / 10000;
      calibrationSource = 'time_specific';
    } else {
      multiplier = adapter.calibrationFunction.multiplier;
      calibrationSource = 'overall';
    }

    // ── Condition-aware multiplier scaling ────────────────────────────────────
    const occlusion  = imageConditions?.estimatedOcclusion ?? 0;
    const brightness = imageConditions?.brightnessScore    ?? 1.0;
    const deviation  = multiplier - 1.0;

    let finalMultiplier: number;
    let conditionAdjustment: 'amplified' | 'reduced' | 'standard';

    if (occlusion > 0.5 || brightness < 0.3) {
      // Hard case: high occlusion or very dark — LLM misses more → amplify correction
      finalMultiplier = 1.0 + deviation * 1.5;
      conditionAdjustment = 'amplified';
    } else if (occlusion < 0.2 && brightness > 0.7) {
      // Easy case: clear, bright image — LLM is likely correct → reduce correction
      finalMultiplier = 1.0 + deviation * 0.5;
      conditionAdjustment = 'reduced';
    } else {
      finalMultiplier = multiplier;
      conditionAdjustment = 'standard';
    }

    finalMultiplier = Math.round(finalMultiplier * 10000) / 10000;

    const adjustedPrediction = Math.round(rawPrediction * finalMultiplier * 100) / 100;
    const pctChange   = ((finalMultiplier - 1) * 100).toFixed(1);
    const directionWord = finalMultiplier >= 1 ? 'underestimates' : 'overestimates';

    const conditionNote = conditionAdjustment !== 'standard'
      ? ` Correction ${conditionAdjustment} (occ=${occlusion.toFixed(2)}, bright=${brightness.toFixed(2)}).`
      : '';

    const explanation =
      `Adjusted based on ${adapter.trainingSize} farmer corrections showing AI ` +
      `${directionWord} by ${Math.abs(parseFloat(pctChange))}% ` +
      `(${calibrationSource === 'time_specific' ? currentWindow + ' window, ' : ''}` +
      `v${adapter.version} adapter, ×${finalMultiplier}).${conditionNote}`;

    console.log(
      `[micro-adapter] Applied v${adapter.version} adapter to '${flowType}': ` +
      `${rawPrediction} → ${adjustedPrediction} (×${finalMultiplier}, ${calibrationSource}, ${conditionAdjustment})`
    );

    return {
      rawPrediction,
      adjustedPrediction,
      adapterApplied: true,
      adapterId: adapter.batchId,
      multiplier,
      finalMultiplier,
      trainingSize: adapter.trainingSize,
      calibrationSource,
      conditionAdjustment,
      explanation,
    };
  } catch (err) {
    // Never crash the app
    console.error(`[micro-adapter] applyMicroAdapter failed for '${flowType}':`, err);
    return { ...noAdapter, finalMultiplier: 1, conditionAdjustment: 'standard', explanation: 'Adapter application failed — using raw prediction.' };
  }
}
