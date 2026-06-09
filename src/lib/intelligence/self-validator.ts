import { connectToDatabase } from '@/lib/mongodb';
import MicroAdapter from '@/lib/db/models/MicroAdapter';
import Interaction from '@/lib/db/models/Interaction';

const MIN_POST_ADAPTER_OUTCOMES = 5;
const BASELINE_SAMPLE_LIMIT     = 20;

// ── Types ─────────────────────────────────────────────────────────────────────

export type ValidationResult = {
  adapterId: string;
  decision: 'keep' | 'rollback';
  reason: string;
  beforeMAE: number;
  afterMAE: number | null;
  improvement: number;
  improvementPercent: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function validateAdapterPerformance(
  adapterId: string,
  flowType: string,
): Promise<ValidationResult> {
  await connectToDatabase();

  // ── Step 1: Load adapter ──────────────────────────────────────────────────

  const adapter = await MicroAdapter.findOne({ batchId: adapterId }).lean();

  if (!adapter) {
    return {
      adapterId,
      decision: 'keep',
      reason: `Adapter ${adapterId} not found — keeping current state.`,
      beforeMAE: 0,
      afterMAE: null,
      improvement: 0,
      improvementPercent: 0,
    };
  }

  const builtAt = adapter.builtAt;

  // ── Step 2: Baseline MAE (interactions before adapter was built) ───────────

  const [beforeRow] = await Interaction.aggregate<{ mae: number }>([
    {
      $match: {
        flowType,
        actualOutcome: { $exists: true, $ne: null },
        createdAt: { $lt: builtAt },
      },
    },
    { $sort: { createdAt: -1 } },
    { $limit: BASELINE_SAMPLE_LIMIT },
    {
      $group: {
        _id: null,
        mae: {
          $avg: {
            $abs: { $subtract: ['$actualOutcome.predictedValue', '$actualOutcome.actualValue'] },
          },
        },
      },
    },
  ]);

  const beforeMAE = r2(beforeRow?.mae ?? 0);

  // ── Step 3: Count post-adapter outcomes ───────────────────────────────────

  const postCount = await Interaction.countDocuments({
    flowType,
    actualOutcome: { $exists: true, $ne: null },
    'geminiOutput.adapterApplied': true,
    createdAt: { $gt: builtAt },
  } as any);

  if (postCount < MIN_POST_ADAPTER_OUTCOMES) {
    console.log(
      `[self-validator] Adapter ${adapterId}: ` +
      `${postCount}/${MIN_POST_ADAPTER_OUTCOMES} post-adapter outcomes — deferring`,
    );
    return {
      adapterId,
      decision: 'keep',
      reason:
        `Insufficient post-adapter data (${postCount}/${MIN_POST_ADAPTER_OUTCOMES}). ` +
        `Keeping adapter pending more outcomes.`,
      beforeMAE,
      afterMAE: null,
      improvement: 0,
      improvementPercent: 0,
    };
  }

  // ── Step 4: Post-adapter MAE ───────────────────────────────────────────────

  const [afterRow] = await Interaction.aggregate<{ mae: number }>([
    {
      $match: {
        flowType,
        actualOutcome: { $exists: true, $ne: null },
        'geminiOutput.adapterApplied': true,
        createdAt: { $gt: builtAt },
      },
    },
    {
      $group: {
        _id: null,
        mae: {
          $avg: {
            $abs: { $subtract: ['$actualOutcome.predictedValue', '$actualOutcome.actualValue'] },
          },
        },
      },
    },
  ]);

  const afterMAE          = r2(afterRow?.mae ?? 0);
  const improvement       = r2(beforeMAE - afterMAE);
  const improvementPercent = beforeMAE > 0
    ? r2(((beforeMAE - afterMAE) / beforeMAE) * 100)
    : 0;

  // ── Step 5: Decision ──────────────────────────────────────────────────────

  if (afterMAE < beforeMAE) {
    // Validated — promote to active, roll back any other active adapters
    await MicroAdapter.updateOne(
      { batchId: adapterId },
      { $set: { status: 'active' } },
    );
    await MicroAdapter.updateMany(
      { flowType, status: 'active', batchId: { $ne: adapterId } },
      { $set: { status: 'rolled_back', replacedBy: adapterId } },
    );
    console.log(
      `[self-validator] Adapter ${adapterId} VALIDATED — ` +
      `MAE ${beforeMAE} → ${afterMAE} (+${improvementPercent}%)`,
    );
    return {
      adapterId,
      decision: 'keep',
      reason: `Adapter improved MAE by ${improvementPercent}%`,
      beforeMAE,
      afterMAE,
      improvement,
      improvementPercent,
    };
  } else {
    // Failed — roll back new adapter, leave any existing active adapter untouched
    await MicroAdapter.updateOne(
      { batchId: adapterId },
      { $set: { status: 'rolled_back' } },
    );
    console.log(
      `[self-validator] Adapter ${adapterId} ROLLED BACK — ` +
      `MAE did not improve (${beforeMAE} → ${afterMAE})`,
    );
    return {
      adapterId,
      decision: 'rollback',
      reason: 'Adapter did not improve accuracy. Rolling back to prevent degradation.',
      beforeMAE,
      afterMAE,
      improvement,
      improvementPercent,
    };
  }
}

// ── Batch helper ──────────────────────────────────────────────────────────────

export async function validatePendingAdapters(): Promise<ValidationResult[]> {
  await connectToDatabase();
  const pending = await MicroAdapter.find({ status: 'pending_validation' }).lean();
  if (pending.length === 0) return [];
  return Promise.all(
    pending.map(a => validateAdapterPerformance(a.batchId, a.flowType)),
  );
}
