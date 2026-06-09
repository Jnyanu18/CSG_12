/**
 * End-to-end test for the cross-validation engine.
 *
 * Run: node --env-file=.env scripts/test-cross-validator.js
 *
 * What it does:
 *   1. Creates a realistic yield-forecast interaction
 *   2. Attaches a farmerCorrection to it
 *   3. Runs the cross-validation algorithm (same logic as cross-validator.ts)
 *   4. Writes a ValidatedCorrection document to MongoDB
 *   5. Reads it back and prints the result
 */

const mongoose = require('mongoose');
const path = require('path');

// ─── Env ──────────────────────────────────────────────────────────────────────
if (!process.env.MONGODB_URI) {
  // Fallback: load dotenv manually if --env-file wasn't used
  require('dotenv').config({ path: path.join(__dirname, '../.env') });
}

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('❌  MONGODB_URI is not set');
  process.exit(1);
}

// ─── Interaction schema (minimal) ─────────────────────────────────────────────
const InteractionSchema = new mongoose.Schema(
  {
    userId:           { type: String, required: true },
    flowType:         { type: String, required: true },
    inputData:        { type: mongoose.Schema.Types.Mixed, required: true },
    geminiOutput:     { type: mongoose.Schema.Types.Mixed, required: true },
    confidence:       { type: String, default: 'medium' },
    uncertaintyType:  { type: String, default: 'model' },
    reasoning:        { type: String, default: 'Test' },
    routedToDataset:  { type: Boolean, default: false },
    farmerCorrection: { type: mongoose.Schema.Types.Mixed },
    actualOutcome:    { type: mongoose.Schema.Types.Mixed },
    timestamp:        { type: Date, default: Date.now },
    createdAt:        { type: Date, default: Date.now },
  },
  { collection: 'interactions' }
);

// ─── ValidatedCorrection schema ───────────────────────────────────────────────
const ValidatedCorrectionSchema = new mongoose.Schema(
  {
    interactionId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Interaction', required: true },
    flowType:       { type: String, required: true },
    predictedValue: { type: Number, required: true },
    correctedValue: { type: Number, required: true },
    delta:          { type: Number, required: true },
    deltaPercent:   { type: Number, required: true },
    cropType:       { type: String, required: true },
    conditions: {
      hourOfDay:       { type: Number, required: true },
      confidence:      { type: String, required: true },
      uncertaintyType: { type: String, required: true },
    },
    validation: {
      confidenceScore:    { type: Number, required: true },
      similarCorrections: { type: Number, required: true },
      consistencyScore:   { type: Number, required: true },
      recommendation:     { type: String, required: true },
      validatedAt:        { type: Date, required: true },
    },
    readyForTraining: { type: Boolean, default: false },
    usedInTraining:   { type: Boolean, default: false },
    trainingBatchId:  { type: String },
  },
  { collection: 'validated_corrections', timestamps: { createdAt: true, updatedAt: false } }
);

// ─── Cross-validation logic (mirrors cross-validator.ts exactly) ──────────────
function extractPredictedFromOutput(geminiOutput, flowType) {
  if (flowType === 'yield-forecast') return geminiOutput.totalExpectedYieldKg ?? 0;
  if (flowType === 'market-price')   return geminiOutput.bestPrice ?? 0;
  return 0;
}

async function crossValidate(Interaction, newCorrection) {
  const currentDelta = newCorrection.correctedValue - newCorrection.predictedValue;

  const candidates = await Interaction.find({
    flowType: newCorrection.flowType,
    'farmerCorrection.correctedValue': { $exists: true },
    _id: { $ne: new mongoose.Types.ObjectId(newCorrection.interactionId) },
  }).sort({ createdAt: -1 }).limit(50).lean();

  const similar = candidates.filter(doc => {
    const output = doc.geminiOutput;
    const docCrop = (output.plantType ?? output.cropType ?? '').toLowerCase();
    const cropMatch = docCrop === newCorrection.cropType.toLowerCase();

    const docHour = new Date(doc.createdAt).getHours();
    const rawDiff = Math.abs(docHour - newCorrection.conditions.hourOfDay);
    const hourMatch = Math.min(rawDiff, 24 - rawDiff) <= 3;

    return cropMatch && hourMatch;
  });

  const totalSimilar = similar.length;

  if (totalSimilar === 0) {
    return {
      isValid: true,
      confidenceScore: 0.3,
      validationReason: 'No similar corrections found to validate against.',
      similarCorrections: 0,
      consistencyScore: 0,
      recommendation: 'pending',
      readyForTraining: false,
    };
  }

  let consistentCount = 0;
  for (const doc of similar) {
    const correctedVal = doc.farmerCorrection?.correctedValue;
    if (typeof correctedVal !== 'number') continue;
    const predictedVal = extractPredictedFromOutput(doc.geminiOutput, doc.flowType);
    const delta = correctedVal - predictedVal;
    const sameDir = (delta > 0 && currentDelta > 0) || (delta < 0 && currentDelta < 0);
    const magDev = Math.abs(currentDelta) > 0
      ? Math.abs(Math.abs(delta) - Math.abs(currentDelta)) / Math.abs(currentDelta)
      : 1;
    if (sameDir && magDev <= 0.4) consistentCount++;
  }

  const consistencyScore = Math.round((consistentCount / totalSimilar) * 100) / 100;

  let confidenceScore;
  if (totalSimilar >= 5)      confidenceScore = consistencyScore;
  else if (totalSimilar >= 2) confidenceScore = Math.round(consistencyScore * 0.7 * 100) / 100;
  else                        confidenceScore = 0.3;

  let recommendation, isValid, readyForTraining, validationReason;
  if (confidenceScore >= 0.7) {
    recommendation = 'accept';  isValid = true;  readyForTraining = true;
    validationReason = `Consistent with ${consistentCount} similar correction${consistentCount !== 1 ? 's' : ''}.`;
  } else if (confidenceScore >= 0.4) {
    recommendation = 'pending'; isValid = true;  readyForTraining = false;
    validationReason = 'Insufficient similar corrections to validate.';
  } else {
    recommendation = 'reject';  isValid = false; readyForTraining = false;
    validationReason = 'Contradicts existing correction patterns.';
  }

  return { isValid, confidenceScore, validationReason, similarCorrections: totalSimilar,
           consistencyScore, recommendation, readyForTraining };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🔌  Connecting to MongoDB…');
  await mongoose.connect(MONGODB_URI, { bufferCommands: false });
  console.log('✅  Connected\n');

  const Interaction        = mongoose.models.Interaction ||
    mongoose.model('Interaction', InteractionSchema);
  const ValidatedCorrection = mongoose.models.ValidatedCorrection ||
    mongoose.model('ValidatedCorrection', ValidatedCorrectionSchema);

  // ── Step 1: Create a test yield-forecast interaction ──────────────────────
  const predictedYield = 420;
  const interaction = await Interaction.create({
    userId:    'test-farmer',
    flowType:  'yield-forecast',
    inputData: {
      analysis: { plantType: 'Tomato', stages: [], summary: 'Test' },
      controls: { numPlants: 50, district: 'Coimbatore' },
    },
    geminiOutput: {
      totalExpectedYieldKg: predictedYield,
      confidence: 0.78,
      notes: 'Test interaction',
      reasoning: 'Generated by test script.',
      yieldCurve: [],
    },
    confidence:      'high',
    uncertaintyType: 'data',
    reasoning:       'Test interaction for cross-validation.',
    createdAt:       new Date(),
  });
  console.log(`📝  Created interaction: ${interaction._id}`);
  console.log(`     flowType: yield-forecast | predictedYield: ${predictedYield} kg\n`);

  // ── Step 2: Attach farmerCorrection ──────────────────────────────────────
  const correctedValue = 380; // farmer says the AI overestimated
  await Interaction.findByIdAndUpdate(interaction._id, {
    farmerCorrection: {
      correctedValue,
      correctedAt: new Date(),
      trustLevel: 'verified',
    },
  });
  console.log(`✏️   Farmer correction saved: ${correctedValue} kg`);
  console.log(`     Delta: ${correctedValue - predictedYield} kg (${((correctedValue - predictedYield)/predictedYield*100).toFixed(1)}%)\n`);

  // ── Step 3: Cross-validate ────────────────────────────────────────────────
  const cropType  = 'Tomato';
  const hourOfDay = new Date().getHours();
  console.log('🔍  Running cross-validation…');

  const validationResult = await crossValidate(Interaction, {
    interactionId:  interaction._id.toString(),
    flowType:       'yield-forecast',
    predictedValue: predictedYield,
    correctedValue,
    cropType,
    conditions: { hourOfDay, confidence: 'high', uncertaintyType: 'data' },
  });

  console.log('\n📊  Cross-validation result:');
  console.log(`     recommendation:     ${validationResult.recommendation.toUpperCase()}`);
  console.log(`     confidenceScore:    ${validationResult.confidenceScore}`);
  console.log(`     consistencyScore:   ${validationResult.consistencyScore}`);
  console.log(`     similarCorrections: ${validationResult.similarCorrections}`);
  console.log(`     isValid:            ${validationResult.isValid}`);
  console.log(`     readyForTraining:   ${validationResult.readyForTraining}`);
  console.log(`     reason:             ${validationResult.validationReason}\n`);

  // ── Step 4: Save ValidatedCorrection ─────────────────────────────────────
  const delta        = correctedValue - predictedYield;
  const deltaPercent = Math.round((delta / predictedYield) * 10000) / 100;

  const vcDoc = await ValidatedCorrection.create({
    interactionId:  interaction._id,
    flowType:       'yield-forecast',
    predictedValue: predictedYield,
    correctedValue,
    delta:          Math.round(delta * 100) / 100,
    deltaPercent,
    cropType,
    conditions: { hourOfDay, confidence: 'high', uncertaintyType: 'data' },
    validation: {
      confidenceScore:    validationResult.confidenceScore,
      similarCorrections: validationResult.similarCorrections,
      consistencyScore:   validationResult.consistencyScore,
      recommendation:     validationResult.recommendation,
      validatedAt:        new Date(),
    },
    readyForTraining: validationResult.readyForTraining,
    usedInTraining:   false,
  });

  console.log(`💾  ValidatedCorrection saved: ${vcDoc._id}`);

  // ── Step 5: Read back and print full document ─────────────────────────────
  const saved = await ValidatedCorrection.findById(vcDoc._id).lean();
  console.log('\n📄  MongoDB document (validated_corrections):');
  console.log(JSON.stringify(saved, null, 2));

  // ── Step 6: Check collection count ───────────────────────────────────────
  const total = await ValidatedCorrection.countDocuments();
  console.log(`\n📈  Total documents in validated_corrections: ${total}`);

  // ── Cleanup test interaction (keep the validated correction) ──────────────
  await Interaction.findByIdAndDelete(interaction._id);
  console.log('\n🧹  Test interaction cleaned up.');
  console.log('✅  End-to-end test complete.\n');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('❌  Test failed:', err);
  process.exit(1);
});
