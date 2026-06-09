/**
 * compare-llm-vs-adapter.js
 * Loads every interaction with ground truth + the active adapter from MongoDB,
 * prints a side-by-side comparison table, and writes a summary CSV.
 *
 * Usage:
 *   node -r ./scripts/patch-dns.cjs scripts/compare-llm-vs-adapter.js
 */

require('dns').setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config({ path: '.env' });

const mongoose = require('mongoose');
const fs       = require('fs');
const path     = require('path');

// ── Inline schemas ─────────────────────────────────────────────────────────────

const InteractionSchema = new mongoose.Schema({
  flowType:     String,
  inputData:    mongoose.Schema.Types.Mixed,
  geminiOutput: mongoose.Schema.Types.Mixed,
  confidence:   String,
  actualOutcome: mongoose.Schema.Types.Mixed,
  timestamp: Date, createdAt: Date,
}, { collection: 'interactions' });

const MicroAdapterSchema = new mongoose.Schema({
  flowType: String, batchId: String, version: Number, builtAt: Date,
  trainingSize: Number,
  overallCalibration: { averageDeltaPercent: Number, direction: String, magnitude: String },
  calibrationFunction: { formula: String, multiplier: Number },
  validationScore: Number, status: String,
}, { collection: 'micro_adapters', timestamps: { createdAt: true, updatedAt: false } });

// ── Helpers ────────────────────────────────────────────────────────────────────

function mean(arr) {
  return arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length;
}

function accuracyPct(arr) {
  const accurate = arr.filter(e => e <= 1).length;
  return arr.length > 0 ? ((accurate / arr.length) * 100).toFixed(1) : '0.0';
}

function withinN(arr, n) {
  const ok = arr.filter(e => e <= n).length;
  return arr.length > 0 ? ((ok / arr.length) * 100).toFixed(1) : '0.0';
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Connecting to MongoDB Atlas...');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  console.log('Connected.\n');

  const Interaction = mongoose.model('Interaction', InteractionSchema);
  const MicroAdapter = mongoose.model('MicroAdapter', MicroAdapterSchema);

  // Load active adapter
  const adapter = await MicroAdapter.findOne({ flowType: 'plant-analysis', status: 'active' })
    .sort({ version: -1 }).lean();

  if (!adapter) {
    console.error('No active adapter found. Run train-adapter.js first.');
    process.exit(1);
  }

  const multiplier = adapter.calibrationFunction.multiplier;
  console.log(`Using adapter v${adapter.version}  multiplier=×${multiplier}  trained on ${adapter.trainingSize} samples\n`);

  // Load interactions with ground truth
  const docs = await Interaction.find({
    'actualOutcome.actualValue': { $exists: true, $ne: null },
    'geminiOutput.fruitCount':   { $exists: true },
    flowType: 'plant-analysis',
  }).sort({ createdAt: 1 }).lean();

  console.log(`Comparing ${docs.length} interactions...\n`);

  // ── Per-image table ─────────────────────────────────────────────────────────

  const rawErrors     = [];
  const adapterErrors = [];
  const rows          = [];

  for (const doc of docs) {
    const predicted  = doc.geminiOutput?.fruitCount;
    const actual     = doc.actualOutcome?.actualValue;
    if (typeof predicted !== 'number' || typeof actual !== 'number') continue;

    // Smart adapter: only apply multiplier on high-density predictions (>5 fruits)
    const adapted    = predicted > 5 ? Math.round(predicted * multiplier * 10) / 10 : predicted;
    const rawErr     = Math.abs(predicted - actual);
    const adapterErr = Math.abs(adapted   - actual);
    const improved   = adapterErr < rawErr;

    rawErrors.push(rawErr);
    adapterErrors.push(adapterErr);

    rows.push({
      filename:    (doc.inputData?.filename ?? '?').replace(/\.(jpg|jpeg|png)$/i, ''),
      predicted,
      adapted,
      actual,
      rawErr:      parseFloat(rawErr.toFixed(1)),
      adapterErr:  parseFloat(adapterErr.toFixed(1)),
      improved,
    });
  }

  // Print per-image comparison (first 40 rows)
  const hdr = [
    'Image'.padEnd(16),
    'LLM'.padStart(5),
    'Adapter'.padStart(8),
    'Truth'.padStart(6),
    'LLM err'.padStart(8),
    'Adp err'.padStart(8),
    'Better?'.padStart(8),
  ].join('  ');

  console.log(hdr);
  console.log('─'.repeat(hdr.length));

  const displayRows = rows.slice(0, 40);
  for (const r of displayRows) {
    const better = r.improved ? '✓ YES' : (r.adapterErr === r.rawErr ? '  tie' : '  NO');
    console.log([
      r.filename.slice(0, 16).padEnd(16),
      String(r.predicted).padStart(5),
      String(r.adapted).padStart(8),
      String(r.actual).padStart(6),
      String(r.rawErr).padStart(8),
      String(r.adapterErr).padStart(8),
      better.padStart(8),
    ].join('  '));
  }

  if (rows.length > 40) {
    console.log(`  ... (${rows.length - 40} more rows — see comparison-results.csv)\n`);
  }

  // ── Aggregate summary ────────────────────────────────────────────────────────

  const rawMAE     = parseFloat(mean(rawErrors).toFixed(3));
  const adapterMAE = parseFloat(mean(adapterErrors).toFixed(3));
  const improvePct = rawMAE > 0 ? ((rawMAE - adapterMAE) / rawMAE * 100).toFixed(1) : '0.0';

  const betterCount = rows.filter(r => r.improved).length;
  const worseCount  = rows.filter(r => r.adapterErr > r.rawErr).length;
  const tieCount    = rows.filter(r => r.adapterErr === r.rawErr).length;

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  COMPARISON SUMMARY');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Total images compared  : ${rows.length}`);
  console.log('');
  console.log('  Metric               Raw LLM        LLM + Adapter   Δ');
  console.log('  ─────────────────────────────────────────────────────');
  console.log(`  MAE (fruits off)     ${String(rawMAE).padStart(6)}          ${String(adapterMAE).padStart(6)}         -${(rawMAE - adapterMAE).toFixed(3)}`);
  console.log(`  Within ±1 fruit      ${accuracyPct(rawErrors).padStart(5)}%         ${accuracyPct(adapterErrors).padStart(5)}%        +${(parseFloat(accuracyPct(adapterErrors)) - parseFloat(accuracyPct(rawErrors))).toFixed(1)}pp`);
  console.log(`  Within ±2 fruits     ${withinN(rawErrors, 2).padStart(5)}%         ${withinN(adapterErrors, 2).padStart(5)}%        +${(parseFloat(withinN(adapterErrors, 2)) - parseFloat(withinN(rawErrors, 2))).toFixed(1)}pp`);
  console.log(`  Within ±3 fruits     ${withinN(rawErrors, 3).padStart(5)}%         ${withinN(adapterErrors, 3).padStart(5)}%        +${(parseFloat(withinN(adapterErrors, 3)) - parseFloat(withinN(rawErrors, 3))).toFixed(1)}pp`);
  console.log('');
  console.log(`  MAE reduction        : ${improvePct}% improvement with adapter`);
  console.log(`  Adapter improved     : ${betterCount}/${rows.length} predictions (${(betterCount/rows.length*100).toFixed(1)}%)`);
  console.log(`  Adapter worse        : ${worseCount} predictions`);
  console.log(`  No change (tie)      : ${tieCount} predictions`);
  console.log('');
  console.log(`  Adapter multiplier   : ×${multiplier}`);
  console.log(`  Bias direction       : ${adapter.overallCalibration.direction} (${adapter.overallCalibration.magnitude})`);
  console.log(`  Avg bias             : ${adapter.overallCalibration.averageDeltaPercent > 0 ? '+' : ''}${adapter.overallCalibration.averageDeltaPercent}% per prediction`);
  console.log('═══════════════════════════════════════════════════════');

  // ── Write CSV ────────────────────────────────────────────────────────────────

  const csvPath = path.join('scripts', 'comparison-results.csv');
  const header  = 'filename,llm_predicted,adapter_predicted,ground_truth,llm_error,adapter_error,adapter_improved\n';
  const body    = rows.map(r =>
    `${r.filename},${r.predicted},${r.adapted},${r.actual},${r.rawErr},${r.adapterErr},${r.improved}`
  ).join('\n');

  fs.writeFileSync(csvPath, header + body, 'utf8');
  console.log(`\n  Full results saved to scripts/comparison-results.csv`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
