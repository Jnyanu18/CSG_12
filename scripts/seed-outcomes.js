'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('ERROR: MONGODB_URI is not set. Check your .env file.');
  process.exit(1);
}

const InteractionSchema = new mongoose.Schema(
  {
    userId:          String,
    flowType:        String,
    imageUrl:        String,
    inputData:       mongoose.Schema.Types.Mixed,
    geminiOutput:    mongoose.Schema.Types.Mixed,
    confidence:      String,
    uncertaintyType: String,
    reasoning:       String,
    routedToDataset: Boolean,
    farmerCorrection: mongoose.Schema.Types.Mixed,
    actualOutcome:   mongoose.Schema.Types.Mixed,
    timestamp:       { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const Interaction =
  mongoose.models.Interaction || mongoose.model('Interaction', InteractionSchema);

function randFloat(min, max) {
  return min + Math.random() * (max - min);
}

function randInt(min, max) {
  return Math.floor(randFloat(min, max + 1));
}

function buildOutcome(flowType, geminiOutput, actualValue) {
  const predictedValue =
    flowType === 'yield-forecast'
      ? geminiOutput.totalExpectedYieldKg
      : geminiOutput.bestPrice;

  const errorMargin   = Math.round((actualValue - predictedValue) * 100) / 100;
  const accuracyPercent = Math.round(
    Math.max(0, 100 - (Math.abs(errorMargin) / predictedValue) * 100) * 100
  ) / 100;

  return {
    type:           flowType === 'yield-forecast' ? 'yield' : 'market_price',
    predictedValue,
    actualValue,
    recordedAt:     new Date(),
    errorMargin,
    accuracyPercent,
  };
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

async function main() {
  await mongoose.connect(MONGODB_URI, { bufferCommands: false });
  console.log('Connected to MongoDB\n');

  // ── Step 1: record synthetic outcomes for existing interactions ────────────
  const existing = await Interaction.find({
    flowType:      { $in: ['yield-forecast', 'market-price'] },
    actualOutcome: { $exists: false },
  }).lean();

  console.log(`Found ${existing.length} existing interaction(s) without outcomes`);

  let existingRecorded = 0;
  for (const doc of existing) {
    const output = doc.geminiOutput;
    const predictedValue =
      doc.flowType === 'yield-forecast'
        ? output.totalExpectedYieldKg
        : output.bestPrice;

    if (!predictedValue || predictedValue <= 0) continue;

    const variance   = doc.flowType === 'yield-forecast' ? 0.15 : 0.10;
    const factor     = 1 + randFloat(-variance, variance);
    const actualValue = Math.round(predictedValue * factor * 100) / 100;
    const outcome    = buildOutcome(doc.flowType, output, actualValue);

    await Interaction.findByIdAndUpdate(doc._id, { actualOutcome: outcome });
    existingRecorded++;
  }

  console.log(`Recorded outcomes for ${existingRecorded} existing interaction(s)\n`);

  // ── Step 2: build 40 synthetic interactions ────────────────────────────────
  // Batch 1 (i 0-19):  older,  accuracy 72-78%,  confidence 60% medium / 40% low
  // Batch 2 (i 20-39): newer,  accuracy 85-91%,  confidence 70% high  / 30% medium
  const syntheticDocs = [];

  for (let i = 0; i < 40; i++) {
    const isBatch1 = i < 20;
    const flowType  = i % 2 === 0 ? 'yield-forecast' : 'market-price';

    const confidence = isBatch1
      ? (Math.random() < 0.6 ? 'medium' : 'low')
      : (Math.random() < 0.7 ? 'high'   : 'medium');

    let geminiOutput;
    let predictedValue;

    if (flowType === 'yield-forecast') {
      predictedValue = Math.round(randFloat(800, 3000) * 10) / 10;
      geminiOutput   = {
        totalExpectedYieldKg: predictedValue,
        confidence:  confidence === 'high' ? 0.88 : confidence === 'medium' ? 0.65 : 0.42,
        notes:       'Synthetic seed data',
        reasoning:   'Synthetic seed interaction for testing accuracy graph',
        yieldCurve:  [],
      };
    } else {
      predictedValue = Math.round(randFloat(20, 60) * 100) / 100;
      geminiOutput   = {
        bestPrice:  predictedValue,
        bestDate:   new Date().toISOString().slice(0, 10),
        confidence,
        reasoning:  'Synthetic seed interaction for testing accuracy graph',
        forecast:   [],
      };
    }

    // actualValue tuned to hit the target accuracy band
    const errorBand   = isBatch1 ? randFloat(0.22, 0.28) : randFloat(0.09, 0.15);
    const sign        = Math.random() < 0.5 ? 1 : -1;
    const actualValue = Math.round(predictedValue * (1 + sign * errorBand) * 100) / 100;
    const outcome     = buildOutcome(flowType, geminiOutput, actualValue);

    // stagger dates so getImprovementOverTime sees batch 1 before batch 2
    const daysOffset = isBatch1 ? randInt(40, 60) : randInt(10, 30);
    const createdAt  = daysAgo(daysOffset);

    syntheticDocs.push({
      userId:          'synthetic',
      flowType,
      inputData:       { synthetic: true, index: i },
      geminiOutput,
      confidence,
      uncertaintyType: 'model',
      reasoning:       'Synthetic seed interaction for testing accuracy graph',
      routedToDataset: false,
      actualOutcome:   outcome,
      timestamp:       createdAt,
      createdAt,
      updatedAt:       createdAt,
    });
  }

  await Interaction.insertMany(syntheticDocs);
  console.log('Inserted 40 synthetic interactions');

  // ── Step 3: print summary ─────────────────────────────────────────────────
  const avg = (docs) =>
    docs.reduce((s, d) => s + d.actualOutcome.accuracyPercent, 0) / docs.length;

  const batch1Avg    = avg(syntheticDocs.slice(0, 20)).toFixed(2);
  const batch2Avg    = avg(syntheticDocs.slice(20, 40)).toFixed(2);
  const improvement  = (parseFloat(batch2Avg) - parseFloat(batch1Avg)).toFixed(2);

  console.log('\n=== Seed Summary ===');
  console.log(`Total synthetic interactions inserted: 40`);
  console.log(`Existing interactions with outcomes added: ${existingRecorded}`);
  console.log(`Total outcomes recorded this run:      ${existingRecorded + 40}`);
  console.log(`Batch 1 avg accuracy (interactions 1-20):  ${batch1Avg}%`);
  console.log(`Batch 2 avg accuracy (interactions 21-40): ${batch2Avg}%`);
  console.log(`Improvement:                               +${improvement}%`);

  await mongoose.disconnect();
  console.log('\nDone. Run "node scripts/seed-outcomes.js" again only to add more data.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
