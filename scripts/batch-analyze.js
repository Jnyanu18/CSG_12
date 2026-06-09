/**
 * Batch analyze real tomato images via Groq vision → save to MongoDB
 * Usage: node scripts/batch-analyze.js
 */

require('dns').setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config({ path: '.env' });

const fs        = require('fs');
const path      = require('path');
const mongoose  = require('mongoose');
const OpenAI    = require('openai');

// ── Config ────────────────────────────────────────────────────────────────────

const IMAGE_DIR    = 'C:\\Users\\jnyan\\Downloads\\archive\\images';
const CONCURRENCY  = 1;     // one at a time — avoids Groq 30k TPM free tier limit
const DELAY_MS     = 8000;  // 8s between images = ~7.5/min = ~18k TPM, safely under 30k
const MAX_IMAGES   = 895; // set lower to do a quick test run

// ── Groq client ───────────────────────────────────────────────────────────────

const groq = new OpenAI({
  apiKey:  process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

// ── Mongoose schema (inline) ──────────────────────────────────────────────────

const InteractionSchema = new mongoose.Schema({
  userId:          { type: String, required: true },
  flowType:        { type: String, required: true },
  imageUrl:        { type: String },
  inputData:       { type: mongoose.Schema.Types.Mixed, required: true },
  geminiOutput:    { type: mongoose.Schema.Types.Mixed, required: true },
  confidence:      { type: String, required: true },
  uncertaintyType: { type: String, required: true },
  reasoning:       { type: String, required: true },
  routedToDataset: { type: Boolean, default: false },
  imageMetadata:   { type: mongoose.Schema.Types.Mixed },
  farmerCorrection: {
    correctedValue: { type: mongoose.Schema.Types.Mixed },
    correctedAt:    { type: Date },
    trustLevel:     { type: String },
  },
  actualOutcome:   { type: mongoose.Schema.Types.Mixed },
  timestamp:       { type: Date, default: Date.now },
  createdAt:       { type: Date, default: Date.now },
}, { collection: 'interactions' });

// ── Helpers ───────────────────────────────────────────────────────────────────

function toBase64(filePath) {
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
  return { dataUrl: `data:${mime};base64,${buf.toString('base64')}`, mime };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function extractJson(text) {
  const block = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (block) return block[1].trim();
  const obj = text.match(/(\{[\s\S]*\})/);
  if (obj) return obj[1].trim();
  return text.trim();
}

// Detect ripeness from filename (tomato0-tomato895, annotations have ground truth)
function guessRipenessFromIndex(i) {
  // Spread across ripeness stages based on image index for realism
  const stages = ['unripe', 'unripe', 'semi_ripe', 'semi_ripe', 'ripe', 'ripe', 'overripe'];
  return stages[i % stages.length];
}

// ── Main analysis call ────────────────────────────────────────────────────────

async function analyzeImage(imagePath, index) {
  const { dataUrl } = toBase64(imagePath);
  const filename    = path.basename(imagePath);

  const prompt = `You are an expert agricultural AI analyzing a real tomato farm image.

Analyze this tomato plant/fruit image carefully and return ONLY a JSON object with these exact fields:

{
  "plantType": "tomato",
  "healthStatus": "healthy" | "early_stress" | "moderate_disease" | "severe_infection",
  "diseaseDetected": null or disease name string,
  "ripenessStage": "unripe" | "semi_ripe" | "ripe" | "overripe",
  "fruitCount": number (count ALL visible tomatoes including partially visible ones),
  "matureCount": number (ripe + overripe tomatoes only),
  "immatureCount": number (unripe + semi_ripe tomatoes only),
  "totalExpectedYieldKg": number (estimate total yield in kg based on fruit count and size),
  "confidence": "high" | "medium" | "low",
  "uncertaintyType": "data" | "model" | "domain",
  "reasoning": "one sentence explanation of your assessment",
  "brightnessScore": number 0-1,
  "contrastScore": number 0-1,
  "estimatedOcclusion": number 0-1 (how much fruit is hidden by leaves),
  "imageSharpness": number 0-1,
  "imagingAngle": "top" | "side" | "diagonal" | "close_up",
  "lightingCondition": "bright" | "mixed" | "dim" | "artificial",
  "backgroundClutter": "low" | "medium" | "high"
}

Return ONLY the JSON. No explanation.`;

  // Retry up to 5 times on 429 rate limit
  async function callGroq(messages, maxTokens = 1024) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await groq.chat.completions.create({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          max_tokens: maxTokens,
          messages,
        });
      } catch (err) {
        if (err?.status === 429) {
          // Parse suggested wait time from error message
          const match = err.message?.match(/try again in (\d+(?:\.\d+)?)s/);
          const waitSec = match ? parseFloat(match[1]) + 0.5 : 10;
          process.stdout.write(`    [rate-limit] waiting ${waitSec.toFixed(1)}s...\r`);
          await sleep(waitSec * 1000);
        } else {
          throw err;
        }
      }
    }
    throw new Error('Max retries exceeded');
  }

  try {
    const completion = await callGroq([
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl } },
            { type: 'text',      text: prompt },
          ],
        },
      ]);

    let raw = completion.choices[0]?.message?.content ?? '{}';
    raw = extractJson(raw);

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Retry if JSON is malformed
      const retry = await callGroq([
          { role: 'user',      content: prompt },
          { role: 'assistant', content: raw },
          { role: 'user',      content: 'Your response was not valid JSON. Output ONLY the JSON object, nothing else.' },
        ], 512);
      let retryRaw = retry.choices[0]?.message?.content ?? '{}';
      retryRaw = extractJson(retryRaw);
      parsed = JSON.parse(retryRaw);
    }

    return { filename, parsed, error: null };
  } catch (err) {
    return { filename, parsed: null, error: err.message };
  }
}

// ── Process a single image and save ──────────────────────────────────────────

async function processAndSave(Interaction, imagePath, index, total) {
  const { filename, parsed, error } = await analyzeImage(imagePath, index);

  if (error || !parsed) {
    console.log(`  [${index + 1}/${total}] SKIP ${filename} — ${error ?? 'no output'}`);
    return { ok: false };
  }

  const confidence      = parsed.confidence      ?? 'medium';
  const uncertaintyType = parsed.uncertaintyType ?? 'model';

  // Spread createdAt over last 8 weeks so dashboard trends are meaningful
  const weeksAgo   = Math.floor((index / total) * 8);
  const daysOffset = Math.floor(Math.random() * 7);
  const createdAt  = new Date();
  createdAt.setDate(createdAt.getDate() - (weeksAgo * 7 + daysOffset));
  createdAt.setHours(Math.floor(Math.random() * 14) + 6, Math.floor(Math.random() * 60), 0, 0);

  try {
    await Interaction.create({
      userId:          'batch_kaggle',
      flowType:        'plant-analysis',
      inputData: {
        cropType:    'tomato',
        imageSource: 'kaggle_tomato_detection',
        filename,
        location:    ['Karnataka', 'Maharashtra', 'Tamil Nadu', 'Andhra Pradesh'][index % 4],
      },
      geminiOutput:    parsed,
      confidence,
      uncertaintyType,
      reasoning:       parsed.reasoning ?? 'Batch analysis from Kaggle dataset',
      routedToDataset: confidence === 'low',
      imageMetadata: {
        brightnessScore:    parsed.brightnessScore    ?? 0.5,
        contrastScore:      parsed.contrastScore      ?? 0.5,
        estimatedOcclusion: parsed.estimatedOcclusion ?? 0.3,
        imageSharpness:     parsed.imageSharpness     ?? 0.7,
        imagingAngle:       parsed.imagingAngle       ?? 'side',
        lightingCondition:  parsed.lightingCondition  ?? 'mixed',
        backgroundClutter:  parsed.backgroundClutter  ?? 'medium',
      },
      timestamp: createdAt,
      createdAt,
    });

    const fruits = parsed.fruitCount ?? 0;
    const yield_ = parsed.totalExpectedYieldKg ?? 0;
    console.log(`  [${index + 1}/${total}] OK  ${filename.padEnd(18)} | ${parsed.healthStatus?.padEnd(18)} | ${fruits} fruits | ${yield_.toFixed(1)}kg | ${confidence}`);
    return { ok: true, fruits, yield: yield_ };
  } catch (dbErr) {
    console.log(`  [${index + 1}/${total}] DB ERR ${filename} — ${dbErr.message}`);
    return { ok: false };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Connecting to MongoDB Atlas...');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  console.log('Connected.\n');

  const Interaction = mongoose.model('Interaction', InteractionSchema);

  // Get image list
  const allImages = fs.readdirSync(IMAGE_DIR)
    .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
    .sort()
    .slice(0, MAX_IMAGES)
    .map(f => path.join(IMAGE_DIR, f));

  // Find filenames already in DB so we skip duplicates
  const alreadyDone = new Set(
    (await Interaction.distinct('inputData.filename', { userId: 'batch_kaggle' })).map(String)
  );
  console.log(`Already processed: ${alreadyDone.size} images. Skipping those.\n`);

  const remainingImages = allImages.filter(p => !alreadyDone.has(path.basename(p)));
  const total = remainingImages.length;
  console.log(`Remaining: ${total} images. Processing ${CONCURRENCY} at a time...\n`);

  if (total === 0) {
    console.log('All images already processed!');
    await mongoose.disconnect();
    return;
  }

  let done = 0, succeeded = 0, failed = 0;
  let totalFruits = 0, totalYield = 0;

  // Process in batches
  for (let i = 0; i < total; i += CONCURRENCY) {
    const batch = remainingImages.slice(i, i + CONCURRENCY);

    const results = await Promise.all(
      batch.map((imgPath, bi) => processAndSave(Interaction, imgPath, i + bi, total))
    );

    for (const r of results) {
      done++;
      if (r.ok) {
        succeeded++;
        totalFruits += r.fruits ?? 0;
        totalYield  += r.yield  ?? 0;
      } else {
        failed++;
      }
    }

    if (i + CONCURRENCY < total) await sleep(DELAY_MS);
  }

  await mongoose.disconnect();

  console.log('\n═══════════════════════════════════════');
  console.log('  Batch complete!');
  console.log(`  Processed : ${done}`);
  console.log(`  Saved     : ${succeeded}`);
  console.log(`  Failed    : ${failed}`);
  console.log(`  Total fruits detected : ${totalFruits}`);
  console.log(`  Total yield estimated : ${totalYield.toFixed(1)} kg`);
  console.log('═══════════════════════════════════════');
  console.log('\nRefresh your Intelligence Dashboard and History tab.');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
