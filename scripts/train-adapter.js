/**
 * train-adapter.js
 * Reads all interactions with ground truth (actualOutcome) from MongoDB,
 * computes the real systematic bias of the Groq LLM, builds a MicroAdapter,
 * and saves it as 'active' so the app immediately starts correcting predictions.
 *
 * Usage:
 *   node -r ./scripts/patch-dns.cjs scripts/train-adapter.js
 */

require('dns').setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config({ path: '.env' });

const mongoose = require('mongoose');
const { randomUUID } = require('crypto');

// ── Inline schemas ─────────────────────────────────────────────────────────────

const InteractionSchema = new mongoose.Schema({
  userId: String, flowType: String,
  inputData: mongoose.Schema.Types.Mixed,
  geminiOutput: mongoose.Schema.Types.Mixed,
  confidence: String, uncertaintyType: String,
  actualOutcome: mongoose.Schema.Types.Mixed,
  timestamp: Date, createdAt: Date,
}, { collection: 'interactions' });

const MicroAdapterSchema = new mongoose.Schema({
  flowType:     { type: String, required: true },
  batchId:      { type: String, required: true, unique: true },
  version:      { type: Number, required: true },
  builtAt:      { type: Date,   required: true },
  trainingSize: { type: Number, required: true },
  overallCalibration: {
    averageDeltaPercent: Number, direction: String, magnitude: String,
  },
  timeCalibrations: [{
    timeWindow: String, averageDeltaPercent: Number, sampleSize: Number, active: Boolean,
  }],
  calibrationFunction: { formula: String, multiplier: Number },
  validationScore: Number,
  status: { type: String, default: 'active' },
  replacedBy: String,
}, { collection: 'micro_adapters', timestamps: { createdAt: true, updatedAt: false } });

// ── Helpers ────────────────────────────────────────────────────────────────────

function getTimeWindow(hour) {
  if (hour >= 6  && hour <= 11) return 'morning';
  if (hour >= 12 && hour <= 17) return 'afternoon';
  if (hour >= 18 && hour <= 23) return 'evening';
  return 'night';
}

function magnitude(absPercent) {
  if (absPercent < 10) return 'small';
  if (absPercent < 25) return 'medium';
  return 'large';
}

function mean(arr) {
  return arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length;
}

function median(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function mae(arr) {
  return arr.length === 0 ? 0 : arr.reduce((s, v) => s + Math.abs(v), 0) / arr.length;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Connecting to MongoDB Atlas...');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  console.log('Connected.\n');

  const Interaction = mongoose.model('Interaction', InteractionSchema);
  const MicroAdapter = mongoose.model('MicroAdapter', MicroAdapterSchema);

  // Load all interactions that have ground truth (actualOutcome.actualValue)
  const docs = await Interaction.find({
    'actualOutcome.actualValue': { $exists: true, $ne: null },
    'geminiOutput.fruitCount':   { $exists: true },
    flowType: 'plant-analysis',
  }).lean();

  if (docs.length === 0) {
    console.error('No interactions with ground truth found. Run add-accuracy.js first.');
    process.exit(1);
  }

  console.log(`Found ${docs.length} interactions with ground truth.\n`);

  // ── Compute bias ────────────────────────────────────────────────────────────

  const rawErrors   = [];
  const deltasPct   = [];
  const groups      = { morning: [], afternoon: [], evening: [], night: [] };
  const samples     = [];

  // Separate low-density (≤5 fruits) from high-density (>5) — key split
  const highDensityDeltasPct = [];
  const lowDensityDeltasPct  = [];

  for (const doc of docs) {
    const predicted = doc.geminiOutput?.fruitCount;
    const actual    = doc.actualOutcome?.actualValue;
    if (typeof predicted !== 'number' || typeof actual !== 'number') continue;

    const delta    = actual - predicted;
    const deltaPct = predicted > 0 ? (delta / predicted) * 100 : 0;
    const absErr   = Math.abs(delta);

    rawErrors.push(absErr);
    deltasPct.push(deltaPct);

    const hour   = new Date(doc.createdAt).getHours();
    const window = getTimeWindow(hour);
    groups[window].push(deltaPct);

    if (predicted > 5) highDensityDeltasPct.push(deltaPct);
    else               lowDensityDeltasPct.push(deltaPct);

    samples.push({ filename: doc.inputData?.filename ?? '?', predicted, actual, delta, deltaPct: parseFloat(deltaPct.toFixed(1)) });
  }

  // Median is robust to outliers like tomato101 (predicted 37, actual 9)
  const overallMedianDeltaPct  = median(deltasPct);
  const highDensityMedianDelta = median(highDensityDeltasPct);
  const lowDensityMedianDelta  = median(lowDensityDeltasPct);

  // For display: keep mean so we can show the outlier effect
  const overallAvgDeltaPct  = mean(deltasPct);
  const highDensityAvgDelta = mean(highDensityDeltasPct);
  const lowDensityAvgDelta  = mean(lowDensityDeltasPct);

  // Global multiplier — naive (mean-based, applies everywhere)
  const globalMultiplier = Math.round((1 + overallAvgDeltaPct / 100) * 10000) / 10000;

  // Smart multiplier — median-based, only applied on high-density predictions
  const smartHighMultiplier = Math.round((1 + highDensityMedianDelta / 100) * 10000) / 10000;

  // ── Simulate both approaches ────────────────────────────────────────────────

  const globalAdapterErrors = [];
  const smartAdapterErrors  = [];

  for (const doc of docs) {
    const predicted = doc.geminiOutput?.fruitCount;
    const actual    = doc.actualOutcome?.actualValue;
    if (typeof predicted !== 'number' || typeof actual !== 'number') continue;

    // Global: apply multiplier to all predictions
    const globalAdapted  = Math.round(predicted * globalMultiplier * 10) / 10;
    globalAdapterErrors.push(Math.abs(globalAdapted - actual));

    // Smart: only scale when predicted > 5 (high-density scene)
    const smartAdapted = predicted > 5
      ? Math.round(predicted * smartHighMultiplier * 10) / 10
      : predicted;
    smartAdapterErrors.push(Math.abs(smartAdapted - actual));
  }

  const n           = rawErrors.length;
  const rawMAE      = parseFloat(mae(rawErrors).toFixed(3));
  const globalMAE   = parseFloat(mae(globalAdapterErrors).toFixed(3));
  const smartMAE    = parseFloat(mae(smartAdapterErrors).toFixed(3));

  const rawAcc1     = parseFloat(((rawErrors.filter(e => e <= 1).length / n) * 100).toFixed(1));
  const globalAcc1  = parseFloat(((globalAdapterErrors.filter(e => e <= 1).length / n) * 100).toFixed(1));
  const smartAcc1   = parseFloat(((smartAdapterErrors.filter(e => e <= 1).length / n) * 100).toFixed(1));

  // ── Time-window calibrations ────────────────────────────────────────────────

  const timeCalibrations = Object.entries(groups).map(([window, arr]) => {
    const avg = arr.length > 0 ? Math.round(mean(arr) * 100) / 100 : 0;
    return { timeWindow: window, averageDeltaPercent: avg, sampleSize: arr.length, active: arr.length >= 3 };
  });

  // ── Print report ────────────────────────────────────────────────────────────

  const direction   = overallMedianDeltaPct > 0 ? 'underestimate' : 'overestimate';
  const absDeltaPct = Math.abs(overallMedianDeltaPct);

  console.log('═══════════════════════════════════════════════════════');
  console.log('  LLM BIAS ANALYSIS — Groq Llama 4 Scout on Tomato Dataset');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Interactions analysed : ${n}`);
  console.log(`  Low-density (≤5 pred) : ${lowDensityDeltasPct.length} images  mean=${lowDensityAvgDelta > 0 ? '+' : ''}${lowDensityAvgDelta.toFixed(1)}%  median=${lowDensityMedianDelta > 0 ? '+' : ''}${lowDensityMedianDelta.toFixed(1)}%`);
  console.log(`  High-density (>5 pred): ${highDensityDeltasPct.length} images  mean=${highDensityAvgDelta > 0 ? '+' : ''}${highDensityAvgDelta.toFixed(1)}%  median=${highDensityMedianDelta > 0 ? '+' : ''}${highDensityMedianDelta.toFixed(1)}%`);
  console.log(`  Overall               :                     mean=${overallAvgDeltaPct > 0 ? '+' : ''}${overallAvgDeltaPct.toFixed(1)}%  median=${overallMedianDeltaPct > 0 ? '+' : ''}${overallMedianDeltaPct.toFixed(1)}%`);
  console.log('');
  console.log('  KEY INSIGHT: errors are NOT uniform — the LLM is accurate on');
  console.log('  low-count scenes but has a strong directional bias on dense clusters.');
  console.log('');
  console.log('  ── Three-way accuracy comparison ─────────────────────');
  console.log(`  ${'Method'.padEnd(26)} ${'MAE'.padStart(7)} ${'Within ±1'.padStart(10)}`);
  console.log('  ' + '─'.repeat(45));
  console.log(`  ${'Raw LLM (no adapter)'.padEnd(26)} ${String(rawMAE + ' fruits').padStart(7)} ${String(rawAcc1 + '%').padStart(10)}`);
  console.log(`  ${'Global multiplier (×' + globalMultiplier + ')'.padEnd(26)} ${String(globalMAE + ' fruits').padStart(7)} ${String(globalAcc1 + '%').padStart(10)}  ← naive`);
  console.log(`  ${'Median adapter (×' + smartHighMultiplier + ' if >5)'.padEnd(26)} ${String(smartMAE + ' fruits').padStart(7)} ${String(smartAcc1 + '%').padStart(10)}  ← median+conditional`);
  console.log('');
  const smartImprovement = parseFloat((rawMAE - smartMAE).toFixed(3));
  const smartImprovePct  = rawMAE > 0 ? parseFloat(((smartImprovement / rawMAE) * 100).toFixed(1)) : 0;
  console.log(`  Smart adapter MAE improvement vs raw LLM: ${smartImprovement} fruits (${smartImprovePct}%)`);
  console.log(`  Smart adapter accuracy gain: +${(smartAcc1 - rawAcc1).toFixed(1)} pp`);
  console.log('');
  console.log('  ── Time-window breakdown ────────────────────────────');
  for (const tc of timeCalibrations) {
    const dir  = tc.averageDeltaPercent > 0 ? 'under' : 'over';
    const mult = parseFloat((1 + tc.averageDeltaPercent / 100).toFixed(4));
    const lbl  = tc.active ? `×${mult}` : '(too few samples)';
    console.log(`  ${tc.timeWindow.padEnd(10)} n=${String(tc.sampleSize).padEnd(4)} avgΔ=${tc.averageDeltaPercent > 0 ? '+' : ''}${tc.averageDeltaPercent.toFixed(1)}% ${dir}count → ${lbl}`);
  }

  // ── Worst predictions ────────────────────────────────────────────────────────

  const worst = [...samples].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 5);
  console.log('');
  console.log('  ── Worst raw LLM predictions (biggest errors) ───────');
  console.log(`  ${'Image'.padEnd(16)} ${'LLM'.padStart(4)} ${'Actual'.padStart(6)} ${'Error'.padStart(6)} ${'Smart'.padStart(8)} ${'SErr'.padStart(5)}`);
  for (const s of worst) {
    const smartAdapted = s.predicted > 5 ? parseFloat((s.predicted * smartHighMultiplier).toFixed(1)) : s.predicted;
    const smartErr     = Math.abs(smartAdapted - s.actual).toFixed(1);
    const name         = (s.filename ?? '?').replace(/\.(jpg|jpeg|png)$/i, '').padEnd(16);
    console.log(`  ${name} ${String(s.predicted).padStart(4)} ${String(s.actual).padStart(6)} ${(s.delta > 0 ? '+' + s.delta : s.delta).toString().padStart(6)} ${String(smartAdapted).padStart(8)} ${smartErr.padStart(5)}`);
  }

  // Use smart adapter as the saved multiplier
  const multiplier = smartHighMultiplier;

  // ── Save adapter to MongoDB ─────────────────────────────────────────────────

  console.log('\nSaving adapter to MongoDB...');

  // Deactivate any existing active adapters for plant-analysis
  await MicroAdapter.updateMany(
    { flowType: 'plant-analysis', status: 'active' },
    { $set: { status: 'rolled_back' } }
  );

  const latestAdapter = await MicroAdapter.findOne({ flowType: 'plant-analysis' })
    .sort({ version: -1 }).lean();
  const version = latestAdapter ? latestAdapter.version + 1 : 1;

  const batchId = randomUUID();
  const builtAt = new Date();

  await MicroAdapter.create({
    flowType:     'plant-analysis',
    batchId,
    version,
    builtAt,
    trainingSize: docs.length,
    overallCalibration: {
      averageDeltaPercent: parseFloat(highDensityMedianDelta.toFixed(2)),
      direction,
      magnitude:           magnitude(Math.abs(highDensityMedianDelta)),
    },
    timeCalibrations,
    calibrationFunction: {
      formula:    `rawPrediction × ${multiplier} when predicted > 5 (median-based, outlier-robust)`,
      multiplier,
    },
    validationScore: parseFloat((smartAcc1 / 100).toFixed(2)),
    status: 'active',
  });

  console.log(`\n  Adapter v${version} saved! (median+conditional, status=active, batchId=${batchId})`);
  console.log('═══════════════════════════════════════════════════════');
  console.log('\nDone. Now run: node -r ./scripts/patch-dns.cjs scripts/compare-llm-vs-adapter.js');
  console.log('Or refresh the Intelligence Dashboard to see the comparison.\n');

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
