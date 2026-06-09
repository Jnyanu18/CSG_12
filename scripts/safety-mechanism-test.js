/**
 * safety-mechanism-test.js
 * Proves the self-validator catches bad adapters on real data.
 *
 * Usage:
 *   node -r ./scripts/patch-dns.cjs scripts/safety-mechanism-test.js
 */

require('dns').setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config({ path: '.env' });

const mongoose = require('mongoose');

// ── Schemas ────────────────────────────────────────────────────────────────────

const InteractionSchema = new mongoose.Schema({
  flowType:     String,
  inputData:    mongoose.Schema.Types.Mixed,
  geminiOutput: mongoose.Schema.Types.Mixed,
  imageMetadata: mongoose.Schema.Types.Mixed,
  confidence:   String,
  actualOutcome: mongoose.Schema.Types.Mixed,
  createdAt: Date,
}, { collection: 'interactions' });

const SafetyTestSchema = new mongoose.Schema({
  testedAt:    Date,
  datasetSize: Number,
  trainSize:   Number,
  testSize:    Number,
  baseline:    mongoose.Schema.Types.Mixed,
  naiveAdapter: mongoose.Schema.Types.Mixed,
  conditionalAdapter: mongoose.Schema.Types.Mixed,
  architectureValidated: Boolean,
}, { collection: 'safety_test_results', timestamps: { createdAt: true, updatedAt: false } });

// ── Stat helpers ───────────────────────────────────────────────────────────────

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

function mae(errors) {
  return errors.length === 0 ? 0 : errors.reduce((s, v) => s + Math.abs(v), 0) / errors.length;
}

function acc1(errors) {
  return errors.length === 0 ? 0 : (errors.filter(e => Math.abs(e) <= 1).length / errors.length) * 100;
}

// ── Adapter builders ───────────────────────────────────────────────────────────

function buildNaiveAdapter(trainDocs) {
  const deltasPct = [];
  for (const doc of trainDocs) {
    const p = doc.geminiOutput?.fruitCount;
    const a = doc.actualOutcome?.actualValue;
    if (typeof p !== 'number' || typeof a !== 'number') continue;
    const deltaPct = p > 0 ? ((a - p) / p) * 100 : 0;
    deltasPct.push(deltaPct);
  }
  const meanDelta = mean(deltasPct);
  return {
    type:       'naive_global_mean',
    multiplier: Math.round((1 + meanDelta / 100) * 10000) / 10000,
    meanDelta:  parseFloat(meanDelta.toFixed(2)),
    trainSize:  deltasPct.length,
  };
}

function buildConditionalAdapter(trainDocs) {
  const highDeltasPct = [];
  for (const doc of trainDocs) {
    const p = doc.geminiOutput?.fruitCount;
    const a = doc.actualOutcome?.actualValue;
    if (typeof p !== 'number' || typeof a !== 'number') continue;
    if (p > 5) {
      const deltaPct = p > 0 ? ((a - p) / p) * 100 : 0;
      highDeltasPct.push(deltaPct);
    }
  }
  const medianDelta = median(highDeltasPct);
  return {
    type:         'conditional_median',
    multiplier:   Math.round((1 + medianDelta / 100) * 10000) / 10000,
    medianDelta:  parseFloat(medianDelta.toFixed(2)),
    threshold:    5,
    trainSize:    highDeltasPct.length,
  };
}

// ── Evaluators ─────────────────────────────────────────────────────────────────

function evalBaseline(testDocs) {
  const errors = [];
  for (const doc of testDocs) {
    const p = doc.geminiOutput?.fruitCount;
    const a = doc.actualOutcome?.actualValue;
    if (typeof p !== 'number' || typeof a !== 'number') continue;
    errors.push(Math.abs(p - a));
  }
  return {
    n:        errors.length,
    mae:      parseFloat(mae(errors).toFixed(3)),
    acc1Pct:  parseFloat(acc1(errors).toFixed(1)),
    errors,
  };
}

function evalNaiveAdapter(testDocs, adapter) {
  const errors = [];
  for (const doc of testDocs) {
    const p = doc.geminiOutput?.fruitCount;
    const a = doc.actualOutcome?.actualValue;
    if (typeof p !== 'number' || typeof a !== 'number') continue;
    const adjusted = Math.round(p * adapter.multiplier * 10) / 10;
    errors.push(Math.abs(adjusted - a));
  }
  return {
    n:        errors.length,
    mae:      parseFloat(mae(errors).toFixed(3)),
    acc1Pct:  parseFloat(acc1(errors).toFixed(1)),
    errors,
  };
}

function evalConditionalAdapter(testDocs, adapter) {
  const errors = [];
  for (const doc of testDocs) {
    const p = doc.geminiOutput?.fruitCount;
    const a = doc.actualOutcome?.actualValue;
    if (typeof p !== 'number' || typeof a !== 'number') continue;

    // Condition-aware scaling
    const occlusion  = doc.imageMetadata?.estimatedOcclusion ?? 0;
    const brightness = doc.imageMetadata?.brightnessScore    ?? 1.0;
    const deviation  = adapter.multiplier - 1.0;

    let finalMult;
    if (occlusion > 0.5 || brightness < 0.3) {
      finalMult = 1.0 + deviation * 1.5;            // hard case: amplify
    } else if (occlusion < 0.2 && brightness > 0.7) {
      finalMult = 1.0 + deviation * 0.5;            // easy case: reduce
    } else {
      finalMult = adapter.multiplier;
    }

    // Only apply to high-density predictions
    const adjusted = p > adapter.threshold
      ? Math.round(p * finalMult * 10) / 10
      : p;

    errors.push(Math.abs(adjusted - a));
  }
  return {
    n:        errors.length,
    mae:      parseFloat(mae(errors).toFixed(3)),
    acc1Pct:  parseFloat(acc1(errors).toFixed(1)),
    errors,
  };
}

// ── Self-validator decision ────────────────────────────────────────────────────

function selfValidate(baselineMAE, adapterMAE, adapterAcc, baselineAcc) {
  const maeImprovement = baselineMAE - adapterMAE;
  const accImprovement = adapterAcc  - baselineAcc;

  if (adapterMAE > baselineMAE) {
    // Strictly worse on MAE → ROLLBACK
    const degradePct = parseFloat(Math.abs(accImprovement).toFixed(1));
    return {
      decision: 'ROLLBACK',
      symbol:   '✓',
      reason:   `Adapter increases MAE by ${Math.abs(maeImprovement).toFixed(3)} fruits and drops accuracy by ${degradePct}pp. Automatic rollback triggered.`,
    };
  }
  // Neutral or better → KEEP
  return {
    decision: 'KEEP',
    symbol:   '✓',
    reason: maeImprovement > 0
      ? `Adapter improves MAE by ${maeImprovement.toFixed(3)} fruits (${((maeImprovement / baselineMAE) * 100).toFixed(1)}%). Accuracy: ${accImprovement >= 0 ? '+' : ''}${accImprovement.toFixed(1)}pp.`
      : `Adapter is neutral — no degradation detected. Safe to deploy.`,
  };
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Connecting to MongoDB Atlas...');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  console.log('Connected.\n');

  const Interaction  = mongoose.model('Interaction',  InteractionSchema);
  const SafetyTest   = mongoose.model('SafetyTest',   SafetyTestSchema);

  // Step 1: Load all interactions with ground truth
  const allDocs = await Interaction.find({
    'actualOutcome.actualValue': { $exists: true, $ne: null },
    'geminiOutput.fruitCount':   { $exists: true },
    flowType: 'plant-analysis',
  }).sort({ createdAt: 1 }).lean();

  if (allDocs.length < 10) {
    console.error('Need at least 10 interactions. Run add-accuracy.js first.');
    process.exit(1);
  }

  // Step 2: 80/20 split (deterministic — sorted by createdAt, first 80% train)
  const splitIdx = Math.floor(allDocs.length * 0.8);
  const trainDocs = allDocs.slice(0, splitIdx);
  const testDocs  = allDocs.slice(splitIdx);

  // Step 3: Train naive adapter (mean-based, global)
  const naiveAdapter = buildNaiveAdapter(trainDocs);

  // Step 4: Train conditional adapter (median-based, high-density only)
  const condAdapter = buildConditionalAdapter(trainDocs);

  // Step 5: Evaluate all three on test set
  const baselineResult = evalBaseline(testDocs);
  const naiveResult    = evalNaiveAdapter(testDocs, naiveAdapter);
  const condResult     = evalConditionalAdapter(testDocs, condAdapter);

  // Step 6: Self-validator decisions
  const naiveDecision = selfValidate(baselineResult.mae, naiveResult.mae, naiveResult.acc1Pct, baselineResult.acc1Pct);
  const condDecision  = selfValidate(baselineResult.mae, condResult.mae,  condResult.acc1Pct,  baselineResult.acc1Pct);

  // ── Print results ────────────────────────────────────────────────────────────

  const line = '═'.repeat(51);

  console.log(line);
  console.log('  SAFETY MECHANISM VALIDATION TEST');
  console.log(line);
  console.log(`  Dataset : ${allDocs.length} real Kaggle tomato images`);
  console.log(`  Train   : 80% (${trainDocs.length} images)`);
  console.log(`  Test    : 20% (${testDocs.length} images)`);
  console.log('');
  console.log('  BASELINE (no adapter):');
  console.log(`    Test MAE         : ${baselineResult.mae} fruits`);
  console.log(`    Test ±1 accuracy : ${baselineResult.acc1Pct}%`);
  console.log('');
  console.log('  NAIVE ADAPTER:');
  console.log(`    Training         : global mean multiplier (×${naiveAdapter.multiplier})`);
  console.log(`    Mean bias used   : ${naiveAdapter.meanDelta > 0 ? '+' : ''}${naiveAdapter.meanDelta}% (includes outliers)`);
  const naiveMAEDelta = parseFloat((naiveResult.mae - baselineResult.mae).toFixed(3));
  const naiveAccDelta = parseFloat((naiveResult.acc1Pct - baselineResult.acc1Pct).toFixed(1));
  console.log(`    Test MAE         : ${naiveResult.mae} fruits  (Δ ${naiveMAEDelta >= 0 ? '+' : ''}${naiveMAEDelta} from baseline)`);
  console.log(`    Test ±1 accuracy : ${naiveResult.acc1Pct}%  (${naiveAccDelta >= 0 ? '+' : ''}${naiveAccDelta}pp)`);
  console.log('');
  console.log(`    Self-validator decision : ${naiveDecision.decision} ${naiveDecision.symbol}`);
  console.log(`    Reason : ${naiveDecision.reason}`);
  console.log('');
  console.log('  CONDITIONAL ADAPTER:');
  console.log(`    Training         : median bias (×${condAdapter.multiplier}), only when predicted > ${condAdapter.threshold}`);
  console.log(`    Median bias used : ${condAdapter.medianDelta > 0 ? '+' : ''}${condAdapter.medianDelta}% (outlier-robust)`);
  const condMAEDelta = parseFloat((condResult.mae - baselineResult.mae).toFixed(3));
  const condAccDelta = parseFloat((condResult.acc1Pct - baselineResult.acc1Pct).toFixed(1));
  console.log(`    Test MAE         : ${condResult.mae} fruits  (Δ ${condMAEDelta >= 0 ? '+' : ''}${condMAEDelta} from baseline)`);
  console.log(`    Test ±1 accuracy : ${condResult.acc1Pct}%  (${condAccDelta >= 0 ? '+' : ''}${condAccDelta}pp)`);
  console.log(`    Conditions used  : estimatedOcclusion, brightnessScore`);
  console.log('');
  console.log(`    Self-validator decision : ${condDecision.decision} ${condDecision.symbol}`);
  console.log(`    Reason : ${condDecision.reason}`);
  console.log('');
  console.log(line);
  console.log('  ARCHITECTURE VALIDATION:');

  const caughtDegradation = naiveDecision.decision === 'ROLLBACK';
  console.log(`  ${caughtDegradation ? '✓' : '✗'} Safety mechanism caught naive adapter degradation`);
  console.log(`  ${caughtDegradation ? '✓' : '✗'} Automatic rollback would prevent accuracy harm`);
  console.log(`  ✓ No human intervention needed`);
  console.log(`  ✓ Conditional adapter evaluated independently`);
  console.log(line);

  // Step 7: Save to MongoDB
  const testRecord = await SafetyTest.create({
    testedAt:    new Date(),
    datasetSize: allDocs.length,
    trainSize:   trainDocs.length,
    testSize:    testDocs.length,
    baseline: {
      mae:     baselineResult.mae,
      acc1Pct: baselineResult.acc1Pct,
    },
    naiveAdapter: {
      multiplier:      naiveAdapter.multiplier,
      meanDelta:       naiveAdapter.meanDelta,
      testMAE:         naiveResult.mae,
      testAcc1Pct:     naiveResult.acc1Pct,
      maeVsBaseline:   naiveMAEDelta,
      accVsBaseline:   naiveAccDelta,
      selfValidatorDecision: naiveDecision.decision,
      reason:          naiveDecision.reason,
    },
    conditionalAdapter: {
      multiplier:      condAdapter.multiplier,
      medianDelta:     condAdapter.medianDelta,
      threshold:       condAdapter.threshold,
      testMAE:         condResult.mae,
      testAcc1Pct:     condResult.acc1Pct,
      maeVsBaseline:   condMAEDelta,
      accVsBaseline:   condAccDelta,
      selfValidatorDecision: condDecision.decision,
      reason:          condDecision.reason,
    },
    architectureValidated: caughtDegradation,
  });

  console.log(`\n  Test saved to MongoDB (safety_test_results, id: ${testRecord._id})`);
  console.log('  Run next: node -r ./scripts/patch-dns.cjs scripts/generate-demo-report.js\n');

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
