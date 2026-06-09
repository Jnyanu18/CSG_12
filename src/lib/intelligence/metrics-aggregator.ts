import { connectToDatabase } from '@/lib/mongodb';
import Interaction from '@/lib/db/models/Interaction';
import ValidatedCorrection from '@/lib/db/models/ValidatedCorrection';
import MicroAdapter from '@/lib/db/models/MicroAdapter';

// ── Return type ───────────────────────────────────────────────────────────────

export interface IntelligenceMetrics {
  correctionRateDecay: {
    byWeek: { week: number; rate: number }[];
    trend: 'improving' | 'stable' | 'degrading';
    percentImprovement: number;
  };
  adapterCalibrationDrift: {
    versions: { version: number; multiplier: number }[];
    converging: boolean;
    latestDrift: number;
  };
  crossValidationAcceptanceRate: {
    byWeek: { week: number; rate: number }[];
    trend: 'improving' | 'stable' | 'degrading';
    currentRate: number;
  };
  predictionErrorReduction: {
    byBatch: { batch: number; mae: number }[];
    trend: 'improving' | 'stable' | 'degrading';
    totalReduction: number;
    totalReductionPercent: number;
  };
  adapterCoverage: {
    total: number;
    withAdapter: number;
    coveragePercent: number;
    trend: 'growing' | 'stable';
  };
  overallIntelligenceScore: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function last<T>(arr: T[]): T | undefined {
  return arr[arr.length - 1];
}

function detectTrend(
  values: number[],
  lowerIsBetter: boolean,
): 'improving' | 'stable' | 'degrading' {
  if (values.length < 2) return 'stable';
  const half = Math.ceil(values.length / 2);
  const a = values.slice(0, half).reduce((s, v) => s + v, 0) / half;
  const b = values.slice(-half).reduce((s, v) => s + v, 0) / half;
  if (a === 0) return 'stable';
  const changePct = ((b - a) / a) * 100;
  if (Math.abs(changePct) < 5) return 'stable';
  return (lowerIsBetter ? changePct < 0 : changePct > 0) ? 'improving' : 'degrading';
}

// ── Aggregation row shapes ────────────────────────────────────────────────────

type WeekRow<Extra extends object> = { _id: { year: number; week: number } } & Extra;

// ── Main ──────────────────────────────────────────────────────────────────────

export async function computeIntelligenceMetrics(): Promise<IntelligenceMetrics> {
  const empty: IntelligenceMetrics = {
    correctionRateDecay:           { byWeek: [], trend: 'stable', percentImprovement: 0 },
    adapterCalibrationDrift:       { versions: [], converging: false, latestDrift: 0 },
    crossValidationAcceptanceRate: { byWeek: [], trend: 'stable', currentRate: 0 },
    predictionErrorReduction:      { byBatch: [], trend: 'stable', totalReduction: 0, totalReductionPercent: 0 },
    adapterCoverage:               { total: 0, withAdapter: 0, coveragePercent: 0, trend: 'stable' },
    overallIntelligenceScore:      0,
  };

  try {
    await connectToDatabase();
  } catch {
    return empty;
  }

  const result: IntelligenceMetrics = { ...empty };

  // ── 1. Correction rate decay ──────────────────────────────────────────────
  // Rate = % of interactions that received a farmer correction, per ISO week.
  // Decreasing rate over time means the AI is getting more accurate.
  try {
    const rows = await Interaction.aggregate<WeekRow<{ total: number; corrected: number }>>([
      {
        $group: {
          _id: {
            year: { $isoWeekYear: '$createdAt' },
            week: { $isoWeek: '$createdAt' },
          },
          total:     { $sum: 1 },
          corrected: { $sum: { $cond: [{ $ifNull: ['$farmerCorrection.correctedAt', false] }, 1, 0] } },
        },
      },
      { $sort: { '_id.year': 1, '_id.week': 1 } },
    ]);

    if (rows.length > 0) {
      const byWeek = rows.map((row, i) => ({
        week: i + 1,
        rate: row.total > 0 ? r2((row.corrected / row.total) * 100) : 0,
      }));
      const rates            = byWeek.map(w => w.rate);
      const first            = rates[0] ?? 0;
      const latest           = last(rates) ?? 0;
      const percentImprovement = first > 0 ? r2(((first - latest) / first) * 100) : 0;
      result.correctionRateDecay = {
        byWeek,
        trend: detectTrend(rates, true),
        percentImprovement,
      };
    }
  } catch { /* return zeros for this metric */ }

  // ── 2. Adapter calibration drift ──────────────────────────────────────────
  // Tracks how the multiplier evolves across adapter versions.
  // Converging = multiplier trending toward 1.0 (less correction needed).
  try {
    const adapters = await MicroAdapter.find({})
      .sort({ version: 1 })
      .select('version calibrationFunction')
      .lean();

    if (adapters.length > 0) {
      const versions = adapters.map(a => ({
        version:    a.version,
        multiplier: r2(a.calibrationFunction.multiplier),
      }));
      const drifts     = versions.map(v => Math.abs(v.multiplier - 1));
      const latestDrift = r2(last(drifts) ?? 0);
      const converging  = drifts.length >= 2 && (last(drifts)! < drifts[0]);
      result.adapterCalibrationDrift = { versions, converging, latestDrift };
    }
  } catch { /* zeros */ }

  // ── 3. Cross-validation acceptance rate ───────────────────────────────────
  // Rate = % of validated corrections recommended 'accept', per ISO week.
  // Rising acceptance means the cross-validator is encountering more consistent corrections.
  try {
    const rows = await ValidatedCorrection.aggregate<WeekRow<{ total: number; accepted: number }>>([
      {
        $group: {
          _id: {
            year: { $isoWeekYear: '$createdAt' },
            week: { $isoWeek: '$createdAt' },
          },
          total:    { $sum: 1 },
          accepted: { $sum: { $cond: [{ $eq: ['$validation.recommendation', 'accept'] }, 1, 0] } },
        },
      },
      { $sort: { '_id.year': 1, '_id.week': 1 } },
    ]);

    if (rows.length > 0) {
      const byWeek = rows.map((row, i) => ({
        week: i + 1,
        rate: row.total > 0 ? r2((row.accepted / row.total) * 100) : 0,
      }));
      const rates       = byWeek.map(w => w.rate);
      const currentRate = last(rates) ?? 0;
      result.crossValidationAcceptanceRate = {
        byWeek,
        trend: detectTrend(rates, false),
        currentRate,
      };
    }
  } catch { /* zeros */ }

  // ── 4. Prediction error reduction ─────────────────────────────────────────
  // MAE per ISO week, using interactions where the farmer recorded an actual outcome.
  // Batches numbered oldest=1, newest=N for chart readability.
  try {
    const rows = await Interaction.aggregate<WeekRow<{ mae: number }>>([
      { $match: { actualOutcome: { $exists: true, $ne: null } } },
      {
        $group: {
          _id: {
            year: { $isoWeekYear: '$createdAt' },
            week: { $isoWeek: '$createdAt' },
          },
          mae: { $avg: { $abs: '$actualOutcome.errorMargin' } },
        },
      },
      { $sort: { '_id.year': 1, '_id.week': 1 } },
    ]);

    if (rows.length > 0) {
      const byBatch = rows.map((row, i) => ({
        batch: i + 1,
        mae:   r2(row.mae ?? 0),
      }));
      const maes                = byBatch.map(b => b.mae);
      const firstMae            = maes[0] ?? 0;
      const lastMae             = last(maes) ?? 0;
      const totalReduction      = r2(firstMae - lastMae);
      const totalReductionPercent = firstMae > 0 ? r2(((firstMae - lastMae) / firstMae) * 100) : 0;
      result.predictionErrorReduction = {
        byBatch,
        trend: detectTrend(maes, true),
        totalReduction,
        totalReductionPercent,
      };
    }
  } catch { /* zeros */ }

  // ── 5. Adapter coverage ───────────────────────────────────────────────────
  // % of yield-forecast interactions where the micro-adapter was applied.
  // "growing" if recent 30-day coverage is meaningfully higher than the all-time rate.
  try {
    const [total, withAdapter] = await Promise.all([
      Interaction.countDocuments({ flowType: 'yield-forecast' }),
      Interaction.countDocuments({ flowType: 'yield-forecast', 'geminiOutput.adapterApplied': true }),
    ]);

    if (total > 0) {
      const coveragePercent = r2((withAdapter / total) * 100);
      const thirtyDaysAgo   = new Date(Date.now() - 30 * 86_400_000);
      const [recentTotal, recentWithAdapter] = await Promise.all([
        Interaction.countDocuments({ flowType: 'yield-forecast', createdAt: { $gte: thirtyDaysAgo } }),
        Interaction.countDocuments({ flowType: 'yield-forecast', createdAt: { $gte: thirtyDaysAgo }, 'geminiOutput.adapterApplied': true }),
      ]);
      const overallRate = withAdapter / total;
      const recentRate  = recentTotal > 0 ? recentWithAdapter / recentTotal : 0;
      result.adapterCoverage = {
        total,
        withAdapter,
        coveragePercent,
        trend: recentRate > overallRate + 0.05 ? 'growing' : 'stable',
      };
    }
  } catch { /* zeros */ }

  // ── 6. Overall intelligence score (0–100) ─────────────────────────────────
  //
  // s1  correctionRateDecay        weight 0.25
  //     Base 50; each 1% improvement adds 0.5 pts. No data → 0.
  //
  // s2  adapterCalibrationDrift    weight 0.15
  //     Drift=0 → 100, drift≥0.5 → 0 (linear). Converging adds +10 bonus.
  //
  // s3  crossValidationAcceptanceRate  weight 0.20
  //     currentRate is already 0-100.
  //
  // s4  predictionErrorReduction    weight 0.20
  //     Base 50; each 1% MAE reduction adds 0.5 pts. No data → 0.
  //
  // s5  adapterCoverage             weight 0.20
  //     coveragePercent is already 0-100.

  const s1 = result.correctionRateDecay.byWeek.length === 0
    ? 0
    : clamp(50 + result.correctionRateDecay.percentImprovement / 2, 0, 100);

  const s2 = result.adapterCalibrationDrift.versions.length === 0
    ? 0
    : clamp(
        (1 - result.adapterCalibrationDrift.latestDrift * 2) * 100 +
        (result.adapterCalibrationDrift.converging ? 10 : 0),
        0, 100,
      );

  const s3 = result.crossValidationAcceptanceRate.currentRate;

  const s4 = result.predictionErrorReduction.byBatch.length === 0
    ? 0
    : clamp(50 + result.predictionErrorReduction.totalReductionPercent / 2, 0, 100);

  const s5 = result.adapterCoverage.coveragePercent;

  result.overallIntelligenceScore = Math.round(
    s1 * 0.25 + s2 * 0.15 + s3 * 0.20 + s4 * 0.20 + s5 * 0.20,
  );

  return result;
}
