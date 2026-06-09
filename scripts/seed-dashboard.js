/**
 * Seed script: populates MongoDB Atlas with 6 weeks of realistic data
 * showing the model improving over time. Run with:
 *   node scripts/seed-dashboard.js
 */

// Use Google DNS — local router DNS doesn't support MongoDB SRV record lookups
require('dns').setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config({ path: '.env' });
const mongoose = require('mongoose');

// ─── Schema definitions ───────────────────────────────────────────────────────

const InteractionSchema = new mongoose.Schema({
  userId:          { type: String, required: true },
  flowType:        { type: String, required: true },
  imageUrl:        { type: String },
  inputData:       { type: mongoose.Schema.Types.Mixed, required: true },
  geminiOutput:    { type: mongoose.Schema.Types.Mixed, required: true },
  confidence:      { type: String, required: true, default: 'medium' },
  uncertaintyType: { type: String, required: true, default: 'model' },
  reasoning:       { type: String, required: true },
  routedToDataset: { type: Boolean, default: false },
  imageMetadata:   { type: mongoose.Schema.Types.Mixed },
  farmerCorrection: {
    correctedValue: { type: mongoose.Schema.Types.Mixed },
    correctedAt:    { type: Date },
    trustLevel:     { type: String },
  },
  actualOutcome: { type: mongoose.Schema.Types.Mixed },
  timestamp:  { type: Date, default: Date.now },
  createdAt:  { type: Date, default: Date.now },
});

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
    failureReason: {
      primaryCause:   { type: String },
      secondaryCause: { type: String },
      confidence:     { type: Number },
      explanation:    { type: String },
      features:       { type: mongoose.Schema.Types.Mixed },
      classifiedAt:   { type: Date },
    },
  },
  {
    collection: 'validated_corrections',
    timestamps: { createdAt: true, updatedAt: false },
  }
);

const MicroAdapterSchema = new mongoose.Schema(
  {
    flowType:     { type: String, required: true },
    batchId:      { type: String, required: true, unique: true },
    version:      { type: Number, required: true },
    builtAt:      { type: Date, required: true },
    trainingSize: { type: Number, required: true },
    overallCalibration: {
      averageDeltaPercent: { type: Number, required: true },
      direction:           { type: String, required: true },
      magnitude:           { type: String, required: true },
    },
    timeCalibrations: [
      {
        timeWindow:          { type: String, required: true },
        averageDeltaPercent: { type: Number, required: true },
        sampleSize:          { type: Number, required: true },
        active:              { type: Boolean, required: true },
      },
    ],
    calibrationFunction: {
      formula:    { type: String, required: true },
      multiplier: { type: Number, required: true },
    },
    validationScore: { type: Number, required: true },
    status:          { type: String, required: true, default: 'active' },
    replacedBy:      { type: String },
  },
  {
    collection: 'micro_adapters',
    timestamps: { createdAt: true, updatedAt: false },
  }
);

const DomainPatternSchema = new mongoose.Schema(
  {
    flowType:             { type: String, required: true },
    patternType:          { type: String, required: true },
    pattern:              { type: String, required: true },
    insight:              { type: String, required: true },
    condition:            { type: String },
    metadata:             { type: mongoose.Schema.Types.Mixed, default: {} },
    extractedAt:          { type: Date, default: Date.now },
    interactionsAnalyzed: { type: Number, required: true },
    active:               { type: Boolean, default: true },
  },
  { collection: 'domain_patterns' }
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}

function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}

function jitter(value, pct) {
  return value * (1 + (Math.random() - 0.5) * 2 * pct);
}

// ─── Config ───────────────────────────────────────────────────────────────────

const CROPS      = ['mango', 'banana', 'tomato', 'rice', 'wheat', 'coconut'];
const FLOW_TYPES = ['yield-forecast', 'plant-analysis', 'market-price'];
const USERS      = ['user_001', 'user_002', 'user_003', 'user_004', 'user_005'];

// Week config: week 1 = oldest (6 weeks ago), week 6 = most recent
const WEEKS = [
  { weekNum: 1, daysAgoStart: 42, daysAgoEnd: 36, correctionRate: 0.35, avgMAE: 28, avgAccuracy: 63 },
  { weekNum: 2, daysAgoStart: 35, daysAgoEnd: 29, correctionRate: 0.28, avgMAE: 22, avgAccuracy: 71 },
  { weekNum: 3, daysAgoStart: 28, daysAgoEnd: 22, correctionRate: 0.22, avgMAE: 17, avgAccuracy: 77 },
  { weekNum: 4, daysAgoStart: 21, daysAgoEnd: 15, correctionRate: 0.16, avgMAE: 13, avgAccuracy: 83 },
  { weekNum: 5, daysAgoStart: 14, daysAgoEnd:  8, correctionRate: 0.12, avgMAE: 10, avgAccuracy: 88 },
  { weekNum: 6, daysAgoStart:  7, daysAgoEnd:  1, correctionRate: 0.08, avgMAE:  8, avgAccuracy: 93 },
];

const INTERACTIONS_PER_WEEK = 33; // ~200 total

// ─── Build interactions ───────────────────────────────────────────────────────

function makeYieldInput(crop) {
  return {
    cropType:         crop,
    farmSizeHectares: parseFloat(rand(0.5, 5).toFixed(2)),
    plantingDate:     new Date(daysAgo(randInt(60, 120))).toISOString().split('T')[0],
    irrigationType:   pick(['drip', 'flood', 'rain-fed']),
    soilType:         pick(['clay', 'loam', 'sandy', 'silt']),
  };
}

function makePlantInput(crop) {
  return {
    cropType:    crop,
    imageBase64: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==', // placeholder
    location:    pick(['Karnataka', 'Maharashtra', 'Tamil Nadu', 'Punjab', 'AP']),
  };
}

function makeMarketInput(crop) {
  return {
    cropType:  crop,
    quantity:  randInt(50, 500),
    location:  pick(['APMC Pune', 'Azadpur Delhi', 'KR Market Bengaluru']),
    harvestDate: new Date(daysAgo(randInt(1, 7))).toISOString().split('T')[0],
  };
}

function makeGeminiYield(predictedKg, accuracy) {
  const confidence = accuracy >= 85 ? 'high' : accuracy >= 72 ? 'medium' : 'low';
  return {
    totalExpectedYieldKg: predictedKg,
    confidence,
    uncertaintyType: confidence === 'low' ? 'domain' : 'model',
    reasoning: `Based on crop type and farm size, expected yield is ${predictedKg.toFixed(1)}kg with ${confidence} confidence.`,
    recommendations: ['Monitor irrigation', 'Check for pests weekly'],
  };
}

function makeGeminiPlant(crop) {
  const healthStates = ['healthy', 'early_stress', 'moderate_disease', 'severe_infection'];
  const health = pick(healthStates);
  return {
    plantType:     crop,
    healthStatus:  health,
    diseaseDetected: health !== 'healthy' ? pick(['leaf blight', 'root rot', 'aphid infestation']) : null,
    confidence:    pick(['high', 'medium', 'low']),
    uncertaintyType: 'model',
    reasoning:     `Plant appears ${health} based on visual inspection.`,
    recommendations: ['Apply neem spray', 'Ensure proper drainage'],
  };
}

function makeGeminiMarket(crop) {
  const price = rand(15, 80);
  return {
    predictedPricePerKg: parseFloat(price.toFixed(2)),
    currency: 'INR',
    confidence: pick(['high', 'medium']),
    uncertaintyType: 'data',
    reasoning:  `Market price for ${crop} estimated at ₹${price.toFixed(2)}/kg based on seasonal trends.`,
    marketTrend: pick(['rising', 'stable', 'falling']),
  };
}

function buildInteractions() {
  const interactions = [];

  for (const week of WEEKS) {
    for (let i = 0; i < INTERACTIONS_PER_WEEK; i++) {
      const flowType  = pick(FLOW_TYPES);
      const crop      = pick(CROPS);
      const dayOffset = randInt(week.daysAgoEnd, week.daysAgoStart);
      const ts        = daysAgo(dayOffset);
      ts.setHours(randInt(6, 20), randInt(0, 59), 0, 0);

      const needsCorrection = Math.random() < week.correctionRate;
      const predictedKg     = parseFloat(rand(50, 400).toFixed(1));
      const errorKg         = jitter(week.avgMAE, 0.4);
      const actualKg        = parseFloat((predictedKg + (Math.random() > 0.5 ? errorKg : -errorKg)).toFixed(1));
      const accuracyPct     = parseFloat(jitter(week.avgAccuracy, 0.08).toFixed(1));

      let inputData, geminiOutput, confidence, uncertaintyType, reasoning;

      if (flowType === 'yield-forecast') {
        inputData    = makeYieldInput(crop);
        geminiOutput = makeGeminiYield(predictedKg, accuracyPct);
        confidence      = geminiOutput.confidence;
        uncertaintyType = geminiOutput.uncertaintyType;
        reasoning       = geminiOutput.reasoning;
      } else if (flowType === 'plant-analysis') {
        inputData    = makePlantInput(crop);
        geminiOutput = makeGeminiPlant(crop);
        confidence      = geminiOutput.confidence;
        uncertaintyType = geminiOutput.uncertaintyType;
        reasoning       = geminiOutput.reasoning;
      } else {
        inputData    = makeMarketInput(crop);
        geminiOutput = makeGeminiMarket(crop);
        confidence      = geminiOutput.confidence;
        uncertaintyType = geminiOutput.uncertaintyType;
        reasoning       = geminiOutput.reasoning;
      }

      const doc = {
        userId:          pick(USERS),
        flowType,
        inputData,
        geminiOutput,
        confidence,
        uncertaintyType,
        reasoning,
        routedToDataset: needsCorrection,
        timestamp:       ts,
        createdAt:       ts,
      };

      if (needsCorrection && flowType === 'yield-forecast') {
        doc.farmerCorrection = {
          correctedValue: actualKg,
          correctedAt:    new Date(ts.getTime() + 3600_000),
          trustLevel:     'verified',
        };
        doc.actualOutcome = {
          type:           'yield',
          predictedValue: predictedKg,
          actualValue:    actualKg,
          recordedAt:     new Date(ts.getTime() + 3600_000),
          errorMargin:    parseFloat(Math.abs(actualKg - predictedKg).toFixed(1)),
          accuracyPercent: accuracyPct,
        };
      } else if (!needsCorrection && flowType === 'yield-forecast' && Math.random() < 0.6) {
        // Good predictions also get outcomes recorded
        const smallError = parseFloat(jitter(week.avgMAE * 0.4, 0.3).toFixed(1));
        const goodActual = parseFloat((predictedKg + (Math.random() > 0.5 ? smallError : -smallError)).toFixed(1));
        doc.actualOutcome = {
          type:           'yield',
          predictedValue: predictedKg,
          actualValue:    goodActual,
          recordedAt:     new Date(ts.getTime() + 7200_000),
          errorMargin:    Math.abs(goodActual - predictedKg),
          accuracyPercent: parseFloat(Math.min(99, accuracyPct + jitter(5, 0.4)).toFixed(1)),
        };
      }

      if (needsCorrection && flowType === 'market-price') {
        const predicted = geminiOutput.predictedPricePerKg;
        const corrected = parseFloat((predicted * rand(0.85, 1.15)).toFixed(2));
        doc.farmerCorrection = {
          correctedValue: corrected,
          correctedAt:    new Date(ts.getTime() + 1800_000),
          trustLevel:     'verified',
        };
      }

      interactions.push(doc);
    }
  }

  return interactions;
}

// ─── Build ValidatedCorrections ───────────────────────────────────────────────

const FAILURE_CAUSES = [
  'systematic_bias',
  'confidence_miscalibration',
  'data_gap',
  'temporal_drift',
  'poor_input_quality',
  'distribution_shift',
  'domain_uncertainty',
];

const FAILURE_EXPLANATIONS = {
  systematic_bias:              'Model consistently overestimates yield for this crop in this soil type.',
  confidence_miscalibration:    'Model reported high confidence but error was large — calibration needed.',
  data_gap:                     'Insufficient training samples for this crop-region combination.',
  temporal_drift:               'Recent weather pattern shift not captured in training data.',
  poor_input_quality:           'Input image had low sharpness/occlusion affecting analysis.',
  distribution_shift:           'New pest/disease variant outside model training distribution.',
  domain_uncertainty:           'Regional agronomic variation not represented in base model.',
};

function buildValidatedCorrections(interactions) {
  const corrections = [];
  const yieldCorrected = interactions.filter(
    i => i.flowType === 'yield-forecast' && i.farmerCorrection
  );

  for (const [weekIdx, week] of WEEKS.entries()) {
    const weekInteractions = yieldCorrected.filter(i => {
      const dayOffset = Math.round((Date.now() - i.createdAt.getTime()) / 86_400_000);
      return dayOffset >= week.daysAgoEnd && dayOffset <= week.daysAgoStart;
    });

    for (const interaction of weekInteractions) {
      const predicted  = interaction.geminiOutput.totalExpectedYieldKg;
      const corrected  = interaction.farmerCorrection.correctedValue;
      const delta      = parseFloat((corrected - predicted).toFixed(1));
      const deltaPct   = parseFloat(((delta / predicted) * 100).toFixed(2));
      const primaryCause   = pick(FAILURE_CAUSES);
      const secondaryCause = Math.random() < 0.6 ? pick(FAILURE_CAUSES.filter(c => c !== primaryCause)) : undefined;
      const causeConfidence = parseFloat(rand(0.55, 0.92).toFixed(2));

      // Earlier weeks: lower consistency, later weeks: higher
      const consistencyScore = parseFloat(Math.min(0.98, 0.4 + weekIdx * 0.1 + rand(0, 0.08)).toFixed(2));
      const confidenceScore  = parseFloat(Math.min(0.97, 0.45 + weekIdx * 0.09 + rand(0, 0.07)).toFixed(2));
      const recommendation   = consistencyScore > 0.7 ? 'accept' : consistencyScore > 0.5 ? 'pending' : 'reject';

      const doc = {
        interactionId:  interaction._id,
        flowType:       'yield-forecast',
        predictedValue: predicted,
        correctedValue: corrected,
        delta,
        deltaPercent:   deltaPct,
        cropType:       interaction.inputData.cropType,
        conditions: {
          hourOfDay:       interaction.createdAt.getHours(),
          confidence:      interaction.confidence,
          uncertaintyType: interaction.uncertaintyType,
        },
        validation: {
          confidenceScore,
          similarCorrections: randInt(2, 15),
          consistencyScore,
          recommendation,
          validatedAt: new Date(interaction.createdAt.getTime() + 7200_000),
        },
        readyForTraining: recommendation === 'accept',
        usedInTraining:   recommendation === 'accept' && weekIdx < 4,
        trainingBatchId:  recommendation === 'accept' && weekIdx < 4 ? `batch_w${weekIdx + 1}_001` : undefined,
        failureReason: {
          primaryCause,
          secondaryCause,
          confidence:   causeConfidence,
          explanation:  FAILURE_EXPLANATIONS[primaryCause],
          features: {
            deltaPercent:    deltaPct,
            confidence:      interaction.confidence,
            uncertaintyType: interaction.uncertaintyType,
            cropType:        interaction.inputData.cropType,
            hourOfDay:       interaction.createdAt.getHours(),
          },
          classifiedAt: new Date(interaction.createdAt.getTime() + 3700_000),
        },
        createdAt: new Date(interaction.createdAt.getTime() + 3600_000),
      };

      corrections.push(doc);
    }
  }

  return corrections;
}

// ─── Build MicroAdapters ──────────────────────────────────────────────────────

function buildMicroAdapters() {
  return [
    {
      flowType:     'yield-forecast',
      batchId:      'batch_v1_yield_20240101',
      version:      1,
      builtAt:      daysAgo(35),
      trainingSize: 18,
      overallCalibration: {
        averageDeltaPercent: -22.4,
        direction:           'underestimate',
        magnitude:           'large',
      },
      timeCalibrations: [
        { timeWindow: 'morning',   averageDeltaPercent: -24.1, sampleSize: 5, active: false },
        { timeWindow: 'afternoon', averageDeltaPercent: -21.3, sampleSize: 8, active: false },
        { timeWindow: 'evening',   averageDeltaPercent: -20.8, sampleSize: 4, active: false },
        { timeWindow: 'night',     averageDeltaPercent: -25.2, sampleSize: 1, active: false },
      ],
      calibrationFunction: { formula: 'output * multiplier', multiplier: 1.224 },
      validationScore:     0.58,
      status:              'rolled_back',
      replacedBy:          'batch_v2_yield_20240201',
      createdAt:           daysAgo(35),
    },
    {
      flowType:     'yield-forecast',
      batchId:      'batch_v2_yield_20240201',
      version:      2,
      builtAt:      daysAgo(14),
      trainingSize: 41,
      overallCalibration: {
        averageDeltaPercent: -8.7,
        direction:           'underestimate',
        magnitude:           'small',
      },
      timeCalibrations: [
        { timeWindow: 'morning',   averageDeltaPercent: -9.2,  sampleSize: 12, active: true },
        { timeWindow: 'afternoon', averageDeltaPercent: -8.1,  sampleSize: 18, active: true },
        { timeWindow: 'evening',   averageDeltaPercent: -8.8,  sampleSize: 8,  active: true },
        { timeWindow: 'night',     averageDeltaPercent: -10.1, sampleSize: 3,  active: true },
      ],
      calibrationFunction: { formula: 'output * multiplier', multiplier: 1.087 },
      validationScore:     0.89,
      status:              'active',
      createdAt:           daysAgo(14),
    },
    {
      flowType:     'plant-analysis',
      batchId:      'batch_v1_plant_20240210',
      version:      1,
      builtAt:      daysAgo(7),
      trainingSize: 22,
      overallCalibration: {
        averageDeltaPercent: 5.3,
        direction:           'overestimate',
        magnitude:           'small',
      },
      timeCalibrations: [
        { timeWindow: 'morning',   averageDeltaPercent: 4.8,  sampleSize: 8,  active: true },
        { timeWindow: 'afternoon', averageDeltaPercent: 6.1,  sampleSize: 10, active: true },
        { timeWindow: 'evening',   averageDeltaPercent: 5.2,  sampleSize: 4,  active: true },
        { timeWindow: 'night',     averageDeltaPercent: 3.9,  sampleSize: 0,  active: false },
      ],
      calibrationFunction: { formula: 'output * multiplier', multiplier: 0.947 },
      validationScore:     0.76,
      status:              'pending_validation',
      createdAt:           daysAgo(7),
    },
  ];
}

// ─── Build DomainPatterns ─────────────────────────────────────────────────────

function buildDomainPatterns() {
  return [
    {
      flowType:             'yield-forecast',
      patternType:          'systematic_bias',
      pattern:              'Model underestimates mango yield by ~22% during afternoon sessions',
      insight:              'Afternoon heat may be causing farmers to report higher expectations. Consider time-of-day calibration for mango forecasts.',
      condition:            'flowType=yield-forecast AND cropType=mango AND hourOfDay IN [12,17]',
      metadata:             { affectedCrop: 'mango', timeRange: '12:00-17:00', sampleSize: 24, avgBias: -22.1 },
      extractedAt:          daysAgo(20),
      interactionsAnalyzed: 87,
      active:               true,
    },
    {
      flowType:             'yield-forecast',
      patternType:          'time_based',
      pattern:              'Prediction accuracy drops 15% for rice crops planted in clay soil',
      insight:              'Clay soil water retention effects on rice yield are underweighted in the model. Add soil-type feature weighting.',
      condition:            'cropType=rice AND soilType=clay',
      metadata:             { affectedCrop: 'rice', soilType: 'clay', accuracyDrop: 15.2, sampleSize: 31 },
      extractedAt:          daysAgo(12),
      interactionsAnalyzed: 112,
      active:               true,
    },
    {
      flowType:             'plant-analysis',
      patternType:          'confidence_unreliable',
      pattern:              'High confidence predictions have 38% error rate for early-stage disease detection',
      insight:              'Model overconfident on subtle early disease markers. Threshold high-confidence plant analysis outputs for secondary review.',
      condition:            'confidence=high AND healthStatus IN [early_stress, moderate_disease]',
      metadata:             { falseHighConfidence: 0.38, affectedStages: ['early_stress', 'moderate_disease'] },
      extractedAt:          daysAgo(8),
      interactionsAnalyzed: 64,
      active:               true,
    },
    {
      flowType:             'yield-forecast',
      patternType:          'systematic_bias',
      pattern:              'Coconut yield overestimated by 18% for farms under 1 hectare',
      insight:              'Small coconut farms have different yield density than large-scale plantations. Training data biased toward larger farms.',
      condition:            'cropType=coconut AND farmSizeHectares < 1',
      metadata:             { affectedCrop: 'coconut', farmSizeThreshold: 1, avgBias: 18.3, sampleSize: 19 },
      extractedAt:          daysAgo(4),
      interactionsAnalyzed: 51,
      active:               true,
    },
  ];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('ERROR: MONGODB_URI not set in .env');
    process.exit(1);
  }

  console.log('Connecting to MongoDB Atlas...');
  await mongoose.connect(uri);
  console.log('Connected.\n');

  const Interaction        = mongoose.model('Interaction',        InteractionSchema);
  const ValidatedCorrection = mongoose.model('ValidatedCorrection', ValidatedCorrectionSchema);
  const MicroAdapter       = mongoose.model('MicroAdapter',       MicroAdapterSchema);
  const DomainPattern      = mongoose.model('DomainPattern',      DomainPatternSchema);

  // ── Clear existing seed data ──
  console.log('Clearing existing data...');
  await Promise.all([
    Interaction.deleteMany({}),
    ValidatedCorrection.deleteMany({}),
    MicroAdapter.deleteMany({}),
    DomainPattern.deleteMany({}),
  ]);
  console.log('Cleared.\n');

  // ── Interactions ──
  console.log('Seeding interactions...');
  const interactionDocs = buildInteractions();
  const savedInteractions = await Interaction.insertMany(interactionDocs);
  console.log(`  Inserted ${savedInteractions.length} interactions.\n`);

  // Attach _id back onto our local objects for FK references
  for (let i = 0; i < savedInteractions.length; i++) {
    interactionDocs[i]._id = savedInteractions[i]._id;
    interactionDocs[i].createdAt = interactionDocs[i].createdAt || savedInteractions[i].createdAt;
  }

  // ── ValidatedCorrections ──
  console.log('Seeding validated corrections...');
  const correctionDocs = buildValidatedCorrections(interactionDocs);
  if (correctionDocs.length > 0) {
    await ValidatedCorrection.insertMany(correctionDocs);
  }
  console.log(`  Inserted ${correctionDocs.length} validated corrections.\n`);

  // ── MicroAdapters ──
  console.log('Seeding micro-adapters...');
  const adapterDocs = buildMicroAdapters();
  await MicroAdapter.insertMany(adapterDocs);
  console.log(`  Inserted ${adapterDocs.length} micro-adapters.\n`);

  // ── DomainPatterns ──
  console.log('Seeding domain patterns...');
  const patternDocs = buildDomainPatterns();
  await DomainPattern.insertMany(patternDocs);
  console.log(`  Inserted ${patternDocs.length} domain patterns.\n`);

  // ── Summary ──
  console.log('=== Seed complete ===');
  console.log(`Interactions:         ${savedInteractions.length}`);
  console.log(`ValidatedCorrections: ${correctionDocs.length}`);
  console.log(`MicroAdapters:        ${adapterDocs.length}`);
  console.log(`DomainPatterns:       ${patternDocs.length}`);

  const corrected = interactionDocs.filter(i => i.farmerCorrection).length;
  console.log(`\nCorrection rate overall: ${((corrected / savedInteractions.length) * 100).toFixed(1)}%`);
  console.log('\nTrend summary:');
  for (const w of WEEKS) {
    console.log(`  Week ${w.weekNum}: correction rate ${(w.correctionRate * 100).toFixed(0)}%, target MAE ${w.avgMAE}kg, target accuracy ${w.avgAccuracy}%`);
  }

  await mongoose.disconnect();
  console.log('\nDone. Dashboard should now show data.');
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
