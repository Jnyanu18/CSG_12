'use server';

import { detectErrorsAutonomously, type AutonomousDetectionResult } from '@/lib/intelligence/autonomous-detector';
import { chatAssistantForInsights, type ChatAssistantForInsightsInput, type ChatAssistantForInsightsOutput } from '@/ai/flows/chat-assistant-for-insights';
import { marketPriceForecasting, type MarketPriceForecastingInput, type MarketPriceForecastingOutput } from '@/ai/flows/market-price-forecasting';
import { analyzePlant } from '@/ai/flows/plant-analysis';
import { forecastYield } from '@/ai/flows/yield-forecasting';
import type { AnalyzePlantInput, PlantAnalysisResult, YieldForecastInput, YieldForecastOutput } from '@/lib/types';
import { saveInteraction, saveCorrection } from '@/lib/db/interactions';
import { recordOutcome, getAccuracyMetrics, getImprovementOverTime } from '@/lib/db/accuracy';
import { enhancePromptWithDomainKnowledge } from '@/lib/intelligence/prompt-enhancer';
import { extractDomainPatterns } from '@/lib/intelligence/pattern-extractor';
import { predictFailureProbability } from '@/lib/intelligence/failure-predictor';
import { crossValidateCorrection } from '@/lib/intelligence/cross-validator';
import { checkAndTriggerAdapterTraining, applyMicroAdapter } from '@/lib/intelligence/micro-adapter';
import { computeIntelligenceMetrics } from '@/lib/intelligence/metrics-aggregator';
import { validatePendingAdapters } from '@/lib/intelligence/self-validator';
import { saveValidatedCorrection } from '@/lib/db/validatedCorrections';
import ValidatedCorrection from '@/lib/db/models/ValidatedCorrection';
import MicroAdapter from '@/lib/db/models/MicroAdapter';
import { classifyFailureCause, generateFailureReport, generateFeedbackReport } from '@/lib/intelligence/failure-reasoner';
import Interaction, { type IInteraction } from '@/lib/db/models/Interaction';
import type { FailurePrediction } from '@/lib/types';
import { connectToDatabase } from '@/lib/mongodb';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';

type CaptureConfig<Input> = {
  flowType: IInteraction['flowType'];
  userId?: string;
  getImageUrl?: (input: Input) => string | undefined;
};

function extractCaptureFields(output: unknown): {
  confidence: IInteraction['confidence'];
  uncertaintyType: IInteraction['uncertaintyType'];
  reasoning: string;
} {
  const o = output as Record<string, unknown>;

  // String confidence: plant-analysis, market-price, chat-assistant.
  // Numeric confidence (0–1): yield-forecasting — map to 'high'|'medium'|'low'.
  const confidence: IInteraction['confidence'] = (() => {
    if (o?.confidence === 'high' || o?.confidence === 'medium' || o?.confidence === 'low') {
      return o.confidence as 'high' | 'medium' | 'low';
    }
    if (typeof o?.confidence === 'number') {
      const n = o.confidence as number;
      return n >= 0.75 ? 'high' : n >= 0.45 ? 'medium' : 'low';
    }
    return 'medium';
  })();

  const uncertaintyType: IInteraction['uncertaintyType'] =
    o?.uncertaintyType === 'data' || o?.uncertaintyType === 'domain'
      ? (o.uncertaintyType as 'data' | 'domain')
      : 'model';

  const reasoning =
    typeof o?.reasoning === 'string' && o.reasoning.trim()
      ? o.reasoning
      : 'No reasoning provided';

  return { confidence, uncertaintyType, reasoning };
}

async function executeFlow<Input, Output>(
  flow: (input: Input) => Promise<Output>,
  input: Input,
  capture?: CaptureConfig<Input>
): Promise<{ success: boolean; data?: Output & { interactionId?: string }; error?: string }> {
  try {
    const data = await flow(input);

    if (capture) {
      try {
        const { confidence, uncertaintyType, reasoning } = extractCaptureFields(data);
        const saved = await saveInteraction({
          userId:          capture.userId ?? 'anonymous',
          flowType:        capture.flowType,
          imageUrl:        capture.getImageUrl?.(input),
          inputData:       input as Record<string, unknown>,
          geminiOutput:    data as Record<string, unknown>,
          confidence,
          uncertaintyType,
          reasoning,
        });
        return { success: true, data: { ...data, interactionId: saved._id.toString() } };
      } catch (captureErr) {
        console.error(`[capture] Failed to save interaction for '${capture.flowType}':`, captureErr);
      }
    }

    return { success: true, data: data as Output & { interactionId?: string } };
  } catch (error) {
    console.error(`Error running flow '${flow.name}':`, error);
    let errorMessage = 'An unknown error occurred.';
    if (error instanceof Error) {
      errorMessage = error.message.includes('API key not valid')
        ? 'Your Gemini API key is not valid. Please check your environment variables.'
        : error.message;
    }
    return { success: false, error: errorMessage };
  }
}

export async function runMarketPriceForecasting(input: MarketPriceForecastingInput) {
  return executeFlow<MarketPriceForecastingInput, MarketPriceForecastingOutput>(
    marketPriceForecasting,
    input,
    { flowType: 'market-price' }
  );
}

export async function runChatAssistant(input: ChatAssistantForInsightsInput) {
  return executeFlow<ChatAssistantForInsightsInput, ChatAssistantForInsightsOutput>(
    chatAssistantForInsights,
    input,
    { flowType: 'chat-assistant' }
  );
}

export type PlantAdapterComparison = {
  rawCount: number;
  adapterCount: number;
  adapterApplied: boolean;
  multiplier: number;
  conditionAdjustment: 'amplified' | 'reduced' | 'standard';
  explanation: string;
};

export async function runPlantAnalysis(input: AnalyzePlantInput): Promise<{
  success: boolean;
  data?: PlantAnalysisResult & { interactionId?: string };
  error?: string;
  failurePrediction?: FailurePrediction;
  message?: string;
  adapterComparison?: PlantAdapterComparison;
}> {
  const hour = new Date().getHours();

  const failurePrediction = await predictFailureProbability('plant-analysis', hour, { hasImage: true });

  if (!failurePrediction.shouldProceed) {
    return {
      success: false,
      failurePrediction,
      message: 'High failure risk detected. Gemini not called. API cost saved.',
    };
  }

  const domainContext = await enhancePromptWithDomainKnowledge('plant-analysis', hour).catch(() => '');
  const result = await executeFlow<AnalyzePlantInput, PlantAnalysisResult>(
    (i) => analyzePlant({ ...i, domainContext }),
    input,
    {
      flowType:    'plant-analysis',
      getImageUrl: (i) => (i as Record<string, unknown>).photoDataUri as string | undefined,
    }
  );

  // Surface "raw LLM count vs adapter-corrected count" for this exact image —
  // the same micro-adapter used in the accuracy experiments, run live here.
  let adapterComparison: PlantAdapterComparison | undefined;
  if (result.success && result.data) {
    const rawCount = result.data.stages.reduce(
      (sum, s) => sum + (s.stage.toLowerCase() !== 'flower' ? s.count : 0),
      0
    );
    // analyzePlant's actual output includes per-image condition fields
    // (brightnessScore, estimatedOcclusion, ...) beyond the PlantAnalysisResult type.
    const rawOutput = result.data as unknown as Record<string, unknown>;
    const imageConditions = {
      estimatedOcclusion: typeof rawOutput.estimatedOcclusion === 'number' ? rawOutput.estimatedOcclusion : undefined,
      brightnessScore:    typeof rawOutput.brightnessScore    === 'number' ? rawOutput.brightnessScore    : undefined,
      imageSharpness:     typeof rawOutput.imageSharpness     === 'number' ? rawOutput.imageSharpness     : undefined,
    };
    const adapterResult = await applyMicroAdapter('plant-analysis', rawCount, imageConditions).catch(() => null);
    if (adapterResult) {
      adapterComparison = {
        rawCount,
        adapterCount:        adapterResult.adjustedPrediction,
        adapterApplied:      adapterResult.adapterApplied,
        multiplier:          adapterResult.finalMultiplier,
        conditionAdjustment: adapterResult.conditionAdjustment,
        explanation:         adapterResult.explanation,
      };
    }
  }

  return { ...result, failurePrediction, adapterComparison };
}

export async function recordActualOutcome(
  interactionId: string,
  actualValue: number
): Promise<{ success: boolean; data?: { predictedValue: number; errorMargin: number; accuracyPercent: number }; error?: string }> {
  try {
    const data = await recordOutcome(interactionId, actualValue);
    return { success: true, data };
  } catch (error) {
    console.error('recordActualOutcome error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function getAccuracyData(): Promise<{
  success: boolean;
  data?: { metrics: Awaited<ReturnType<typeof getAccuracyMetrics>>; improvement: Awaited<ReturnType<typeof getImprovementOverTime>> };
  error?: string;
}> {
  try {
    const [metrics, improvement] = await Promise.all([getAccuracyMetrics(), getImprovementOverTime()]);
    return { success: true, data: { metrics, improvement } };
  } catch (error) {
    console.error('getAccuracyData error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function runYieldForecast(input: YieldForecastInput): Promise<{
  success: boolean;
  data?: YieldForecastOutput & { interactionId?: string };
  error?: string;
  failurePrediction?: FailurePrediction;
  message?: string;
  adapterApplied?: boolean;
  adapterInfo?: { adapterId: string; multiplier: number; trainingSize: number; explanation: string };
}> {
  const hour = new Date().getHours();

  const failurePrediction = await predictFailureProbability('yield-forecast', hour, { hasImage: false });

  if (!failurePrediction.shouldProceed) {
    return {
      success: false,
      failurePrediction,
      message: 'High failure risk detected. Gemini not called. API cost saved.',
    };
  }

  const domainContext = await enhancePromptWithDomainKnowledge('yield-forecast', hour).catch(() => '');

  try {
    // Step 1: Get raw prediction from Gemini (no save yet)
    const rawOutput = await forecastYield({ ...input, domainContext });

    // Step 2: Apply micro-adapter (never crashes — returns rawPrediction on error)
    const adapterResult = await applyMicroAdapter('yield-forecast', rawOutput.totalExpectedYieldKg)
      .catch(() => null);

    // Step 3: Build final output — use adjusted prediction if adapter applied
    const finalOutput: YieldForecastOutput & Record<string, unknown> = {
      ...rawOutput,
      totalExpectedYieldKg: adapterResult?.adapterApplied
        ? adapterResult.adjustedPrediction
        : rawOutput.totalExpectedYieldKg,
    };

    if (adapterResult?.adapterApplied) {
      finalOutput.rawPrediction      = rawOutput.totalExpectedYieldKg;
      finalOutput.adjustedPrediction = adapterResult.adjustedPrediction;
      finalOutput.adapterApplied     = true;
      finalOutput.adapterExplanation = adapterResult.explanation;
    }

    // Step 4: Save interaction with final (possibly adjusted) output
    let interactionId: string | undefined;
    try {
      const { confidence, uncertaintyType, reasoning } = extractCaptureFields(finalOutput);
      const saved = await saveInteraction({
        userId:       'anonymous',
        flowType:     'yield-forecast',
        inputData:    input as Record<string, unknown>,
        geminiOutput: finalOutput as Record<string, unknown>,
        confidence,
        uncertaintyType,
        reasoning,
      });
      interactionId = saved._id.toString();
    } catch (captureErr) {
      console.error('[capture] Failed to save yield-forecast interaction:', captureErr);
    }

    return {
      success: true,
      data: { ...finalOutput, interactionId } as YieldForecastOutput & { interactionId?: string },
      failurePrediction,
      adapterApplied: adapterResult?.adapterApplied ?? false,
      adapterInfo: adapterResult?.adapterApplied
        ? {
            adapterId:    adapterResult.adapterId,
            multiplier:   adapterResult.multiplier,
            trainingSize: adapterResult.trainingSize,
            explanation:  adapterResult.explanation,
          }
        : undefined,
    };
  } catch (error) {
    console.error('runYieldForecast error:', error);
    let errorMessage = 'An unknown error occurred.';
    if (error instanceof Error) {
      errorMessage = error.message.includes('API key not valid')
        ? 'Your Gemini API key is not valid. Please check your environment variables.'
        : error.message;
    }
    return { success: false, error: errorMessage, failurePrediction };
  }
}

export async function runPatternExtraction(): Promise<{
  success: boolean;
  data?: { patternsFound: number; patterns: Awaited<ReturnType<typeof extractDomainPatterns>> };
  error?: string;
}> {
  try {
    const patterns = await extractDomainPatterns();
    return { success: true, data: { patternsFound: patterns.length, patterns } };
  } catch (error) {
    console.error('runPatternExtraction error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function submitFarmerCorrection(
  interactionId: string,
  correctedValue: number
): Promise<{
  success: boolean;
  validation?: {
    recommendation: 'accept' | 'pending' | 'reject';
    confidenceScore: number;
    reason: string;
    readyForTraining: boolean;
  };
  adapterBuilt?: boolean;
  trainingSize?: number;
  calibrationMultiplier?: number;
  error?: string;
}> {
  try {
    // 1. Save correction to interactions collection (always, regardless of validation)
    const saved = await saveCorrection(interactionId, correctedValue);
    if (!saved) throw new Error(`Interaction ${interactionId} not found`);

    const output    = saved.geminiOutput as Record<string, unknown>;
    const inputData = saved.inputData    as Record<string, unknown>;

    // Extract predicted value based on flow type
    let predictedValue: number;
    if (saved.flowType === 'yield-forecast') {
      // Use rawPrediction if available (adapter was applied), otherwise totalExpectedYieldKg
      predictedValue =
        typeof output.rawPrediction        === 'number' ? output.rawPrediction :
        typeof output.totalExpectedYieldKg === 'number' ? output.totalExpectedYieldKg : 0;
    } else if (saved.flowType === 'market-price') {
      predictedValue = typeof output.bestPrice === 'number' ? output.bestPrice : 0;
    } else {
      predictedValue = 0;
    }

    // Extract crop type — check geminiOutput first, then inputData.analysis
    const cropType =
      (output.plantType  as string | undefined) ??
      (output.cropType   as string | undefined) ??
      ((inputData?.analysis as Record<string, unknown> | undefined)?.plantType as string | undefined) ??
      'unknown';

    const hourOfDay = new Date(saved.createdAt).getHours();

    // 2. Cross-validate (advisory — never blocks the save)
    const validationResult = await crossValidateCorrection({
      interactionId,
      flowType:       saved.flowType,
      predictedValue,
      correctedValue,
      cropType,
      imageMetadata:  saved.imageMetadata as Record<string, unknown> | undefined,
      conditions: {
        hourOfDay,
        confidence:      saved.confidence,
        uncertaintyType: saved.uncertaintyType,
      },
    });

    // 3. Persist the validated correction record
    const savedCorrDoc = await saveValidatedCorrection({
      interactionId,
      flowType:       saved.flowType,
      predictedValue,
      correctedValue,
      cropType,
      conditions: {
        hourOfDay,
        confidence:      saved.confidence,
        uncertaintyType: saved.uncertaintyType,
      },
      validation: validationResult,
    });

    // 3b. Classify failure cause and attach to the validated correction record
    try {
      const interactionFeatures: Record<string, unknown> = {
        confidence:      saved.confidence,
        uncertaintyType: saved.uncertaintyType,
        flowType:        saved.flowType,
        imageMetadata:   saved.imageMetadata,
      };
      const correctionFeatures: Record<string, unknown> = {
        deltaPercent: savedCorrDoc.deltaPercent,
        delta:        savedCorrDoc.delta,
        flowType:     savedCorrDoc.flowType,
        cropType:     savedCorrDoc.cropType,
        conditions:   savedCorrDoc.conditions,
        validation:   savedCorrDoc.validation,
      };
      const classification = classifyFailureCause(interactionFeatures, correctionFeatures);
      await ValidatedCorrection.updateOne(
        { _id: savedCorrDoc._id },
        {
          $set: {
            failureReason: {
              primaryCause:   classification.primaryCause,
              secondaryCause: classification.secondaryCause,
              confidence:     classification.confidence,
              explanation:    classification.explanation,
              features:       classification.features,
              classifiedAt:   new Date(),
            },
          },
        },
      );
    } catch {
      // Never block the correction save
    }

    // 4. Check if adapter training threshold has been reached (10+ ready corrections)
    const adapterCheck = await checkAndTriggerAdapterTraining(saved.flowType).catch(() => null);

    // 5. Return to client
    return {
      success: true,
      validation: {
        recommendation:  validationResult.recommendation,
        confidenceScore: validationResult.confidenceScore,
        reason:          validationResult.validationReason,
        readyForTraining: validationResult.readyForTraining,
      },
      adapterBuilt:         adapterCheck?.triggered     ?? false,
      trainingSize:         adapterCheck?.trainingSize,
      calibrationMultiplier: adapterCheck?.calibrationMultiplier,
    };
  } catch (error) {
    console.error('submitFarmerCorrection error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function getIntelligenceMetrics(): Promise<{
  success: boolean;
  data?: Awaited<ReturnType<typeof computeIntelligenceMetrics>> & {
    readyForTrainingCount: number;
    adapterStatusCounts: { active: number; pendingValidation: number; rolledBack: number };
  };
  error?: string;
}> {
  try {
    const metrics = await computeIntelligenceMetrics();
    const [readyForTrainingCount, activeCount, pendingCount, rolledBackCount] = await Promise.all([
      ValidatedCorrection.countDocuments({ readyForTraining: true, usedInTraining: false }),
      MicroAdapter.countDocuments({ status: 'active' }),
      MicroAdapter.countDocuments({ status: 'pending_validation' }),
      MicroAdapter.countDocuments({ status: 'rolled_back' }),
    ]);
    return {
      success: true,
      data: {
        ...metrics,
        readyForTrainingCount,
        adapterStatusCounts: { active: activeCount, pendingValidation: pendingCount, rolledBack: rolledBackCount },
      },
    };
  } catch (error) {
    console.error('getIntelligenceMetrics error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function runIntelligenceUpdate(): Promise<{
  success: boolean;
  data?: {
    patternsExtracted: number;
    yieldForecastTriggered: boolean;
    plantAnalysisTriggered: boolean;
    validationsRun: number;
    validationsKept: number;
    validationsRolledBack: number;
  };
  error?: string;
}> {
  try {
    const [patterns, yieldCheck, plantCheck, validations] = await Promise.all([
      extractDomainPatterns(),
      checkAndTriggerAdapterTraining('yield-forecast'),
      checkAndTriggerAdapterTraining('plant-analysis'),
      validatePendingAdapters(),
    ]);
    return {
      success: true,
      data: {
        patternsExtracted:      patterns.length,
        yieldForecastTriggered: yieldCheck.triggered,
        plantAnalysisTriggered: plantCheck.triggered,
        validationsRun:         validations.length,
        validationsKept:        validations.filter(v => v.decision === 'keep').length,
        validationsRolledBack:  validations.filter(v => v.decision === 'rollback').length,
      },
    };
  } catch (error) {
    console.error('runIntelligenceUpdate error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function getModelWeaknessReport(): Promise<{
  success: boolean;
  data?: Awaited<ReturnType<typeof generateFailureReport>>[];
  error?: string;
}> {
  try {
    const flowTypes = ['yield-forecast', 'plant-analysis', 'market-price'] as const;
    const reports = await Promise.all(flowTypes.map(ft => generateFailureReport(ft, 30)));
    return { success: true, data: reports };
  } catch (error) {
    console.error('getModelWeaknessReport error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function exportFeedbackReport(): Promise<{
  success: boolean;
  data?: Awaited<ReturnType<typeof generateFeedbackReport>>;
  error?: string;
}> {
  try {
    const report = await generateFeedbackReport();
    return { success: true, data: report };
  } catch (error) {
    console.error('exportFeedbackReport error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function getImageQualityAnalysis(): Promise<{
  success: boolean;
  data?: {
    avgBrightness: number | null;
    avgOcclusion: number | null;
    mostCommonAngle: string | null;
    mostCommonFailureCause: string | null;
  };
  error?: string;
}> {
  try {
    await connectToDatabase();

    const interactions = await Interaction.find({
      flowType: 'plant-analysis',
      imageMetadata: { $exists: true, $ne: null },
    })
      .select('imageMetadata')
      .lean();

    let totalBrightness = 0;
    let brightnessCount = 0;
    let totalOcclusion = 0;
    let occlusionCount = 0;
    const angleCounts: Record<string, number> = {};

    for (const doc of interactions) {
      const meta = (doc as unknown as Record<string, unknown>).imageMetadata as Record<string, unknown> | undefined;
      if (!meta) continue;

      if (typeof meta.brightnessScore === 'number') {
        totalBrightness += meta.brightnessScore;
        brightnessCount++;
      }
      if (typeof meta.estimatedOcclusion === 'number') {
        totalOcclusion += meta.estimatedOcclusion;
        occlusionCount++;
      }
      if (typeof meta.imagingAngle === 'string') {
        angleCounts[meta.imagingAngle] = (angleCounts[meta.imagingAngle] ?? 0) + 1;
      }
    }

    const avgBrightness = brightnessCount > 0
      ? Math.round((totalBrightness / brightnessCount) * 100) / 100
      : null;
    const avgOcclusion = occlusionCount > 0
      ? Math.round((totalOcclusion / occlusionCount) * 100) / 100
      : null;
    const mostCommonAngle =
      Object.entries(angleCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    const corrections = await ValidatedCorrection.find({
      'failureReason.primaryCause': { $exists: true },
    })
      .select('failureReason')
      .lean();

    const causeCounts: Record<string, number> = {};
    for (const c of corrections) {
      const cause = (c.failureReason as Record<string, unknown> | undefined)
        ?.primaryCause as string | undefined;
      if (cause) causeCounts[cause] = (causeCounts[cause] ?? 0) + 1;
    }
    const mostCommonFailureCause =
      Object.entries(causeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    return {
      success: true,
      data: { avgBrightness, avgOcclusion, mostCommonAngle, mostCommonFailureCause },
    };
  } catch (error) {
    console.error('getImageQualityAnalysis error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export type HistoryItem = {
  id: string;
  date: string;
  flowType: string;
  crop: string;
  location: string;
  confidence: string;
  expectedYield: number | null;
  detections: number | null;
  hasCorrected: boolean;
  status: 'Completed' | 'Corrected' | 'Pending';
};

export async function getInteractionHistory(limit = 50): Promise<{
  success: boolean;
  data?: HistoryItem[];
  error?: string;
}> {
  try {
    await connectToDatabase();

    const docs = await Interaction.find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const data: HistoryItem[] = (docs as unknown as Record<string, unknown>[]).map((doc: Record<string, unknown>) => {
      const output = (doc.geminiOutput ?? {}) as Record<string, unknown>;
      const input  = (doc.inputData  ?? {}) as Record<string, unknown>;

      const crop =
        (output.plantType   as string | undefined) ??
        (output.cropType    as string | undefined) ??
        (input.cropType     as string | undefined) ??
        'Unknown';

      const location =
        (input.location  as string | undefined) ??
        (input.district  as string | undefined) ??
        (input.region    as string | undefined) ??
        '—';

      const expectedYield =
        typeof output.totalExpectedYieldKg === 'number' ? output.totalExpectedYieldKg :
        typeof output.predictedYieldKg     === 'number' ? output.predictedYieldKg : null;

      const detections =
        typeof output.fruitCount      === 'number' ? output.fruitCount :
        typeof output.totalFruitCount === 'number' ? output.totalFruitCount : null;

      const hasCorrected = !!(doc.farmerCorrection as Record<string, unknown> | undefined)?.correctedAt;

      return {
        id:           (doc._id as { toString(): string }).toString(),
        date:         (doc.createdAt as Date).toISOString(),
        flowType:     (doc.flowType as string) ?? 'unknown',
        crop,
        location,
        confidence:   (doc.confidence as string) ?? 'medium',
        expectedYield,
        detections,
        hasCorrected,
        status: hasCorrected ? 'Corrected' : 'Completed',
      };
    });

    return { success: true, data };
  } catch (error) {
    console.error('getInteractionHistory error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// ── LLM vs Adapter comparison ─────────────────────────────────────────────────

export type AdapterComparisonRow = {
  filename: string;
  predicted: number;
  adapted: number;
  actual: number;
  rawError: number;
  adapterError: number;
  improved: boolean;
};

export type AdapterComparisonResult = {
  success: boolean;
  error?: string;
  adapterVersion?: number;
  multiplier?: number;
  naiveMultiplier?: number;
  biasDirection?: string;
  biasMagnitude?: string;
  avgDeltaPct?: number;
  trainingSize?: number;
  totalCompared?: number;
  // Raw LLM
  rawMAE?: number;
  rawWithin1Pct?: number;
  rawWithin2Pct?: number;
  // Naive global adapter
  naiveMAE?: number;
  naiveWithin1Pct?: number;
  // Smart conditional adapter (only applied when predicted > 5)
  smartMAE?: number;
  smartWithin1Pct?: number;
  smartWithin2Pct?: number;
  smartImprovementPct?: number;
  smartBetterCount?: number;
  smartWorseCount?: number;
  // Distribution insight
  lowDensityCount?: number;
  highDensityCount?: number;
  lowDensityBiasPct?: number;
  highDensityBiasPct?: number;
  samples?: AdapterComparisonRow[];
};

export async function getAdapterComparison(): Promise<AdapterComparisonResult> {
  try {
    await connectToDatabase();

    const adapter = await MicroAdapter.findOne({ flowType: 'plant-analysis', status: 'active' })
      .sort({ version: -1 }).lean() as Record<string, unknown> | null;

    if (!adapter) {
      return { success: false, error: 'No active adapter. Run train-adapter.js first.' };
    }

    const calibFn = adapter.calibrationFunction as Record<string, unknown>;
    const multiplier = calibFn.multiplier as number;

    // The "naive" simulation must reflect what the actual rejected naive adapter
    // would have done — not the active (conditional) adapter's multiplier. The
    // safety-mechanism-test run is the authoritative record of that comparison.
    const latestSafetyTest = await connectToDatabase()
      .then(m => m.connection.db!.collection('safety_test_results').find({}).sort({ _id: -1 }).limit(1).toArray())
      .then(rows => rows[0] as Record<string, unknown> | undefined);
    const naiveAdapterRecord = latestSafetyTest?.naiveAdapter as Record<string, unknown> | undefined;
    const naiveMultiplier = (naiveAdapterRecord?.multiplier as number | undefined) ?? multiplier;

    const docs = await Interaction.find({
      'actualOutcome.actualValue': { $exists: true, $ne: null },
      'geminiOutput.fruitCount':   { $exists: true },
      flowType: 'plant-analysis',
    }).sort({ createdAt: 1 }).lean() as unknown as Record<string, unknown>[];

    const rawErrors:   number[] = [];
    const naiveErrors: number[] = [];
    const smartErrors: number[] = [];
    const rows: AdapterComparisonRow[] = [];
    const deltasPct: number[] = [];
    const lowDeltasPct:  number[] = [];
    const highDeltasPct: number[] = [];

    for (const doc of docs) {
      const output    = (doc.geminiOutput ?? {}) as Record<string, unknown>;
      const outcome   = (doc.actualOutcome ?? {}) as Record<string, unknown>;
      const input     = (doc.inputData ?? {}) as Record<string, unknown>;
      const predicted = typeof output.fruitCount   === 'number' ? output.fruitCount   : null;
      const actual    = typeof outcome.actualValue  === 'number' ? outcome.actualValue : null;
      if (predicted === null || actual === null) continue;

      const delta    = actual - predicted;
      const deltaPct = predicted > 0 ? (delta / predicted) * 100 : 0;
      deltasPct.push(deltaPct);
      if (predicted > 5) highDeltasPct.push(deltaPct);
      else               lowDeltasPct.push(deltaPct);

      // Naive: apply the (rejected) global multiplier to everything
      const naiveAdapted = Math.round(predicted * naiveMultiplier * 10) / 10;
      // Smart: only apply when high-density (predicted > 5)
      const smartAdapted = predicted > 5 ? Math.round(predicted * multiplier * 10) / 10 : predicted;

      const rawErr   = Math.abs(predicted    - actual);
      const naiveErr = Math.abs(naiveAdapted - actual);
      const smartErr = Math.abs(smartAdapted - actual);

      rawErrors.push(rawErr);
      naiveErrors.push(naiveErr);
      smartErrors.push(smartErr);

      rows.push({
        filename:     String(input.filename ?? '').replace(/\.(jpg|jpeg|png)$/i, ''),
        predicted,
        adapted:      smartAdapted,
        actual,
        rawError:     parseFloat(rawErr.toFixed(1)),
        adapterError: parseFloat(smartErr.toFixed(1)),
        improved:     smartErr < rawErr,
      });
    }

    const n = rows.length;
    if (n === 0) return { success: false, error: 'No interactions with ground truth found.' };

    const sum  = (a: number[]) => a.reduce((s, v) => s + v, 0);
    const avg  = (a: number[]) => a.length > 0 ? sum(a) / a.length : 0;
    const pct1 = (a: number[]) => parseFloat(((a.filter(e => e <= 1).length / n) * 100).toFixed(1));
    const pct2 = (a: number[]) => parseFloat(((a.filter(e => e <= 2).length / n) * 100).toFixed(1));

    const rawMAE   = parseFloat(avg(rawErrors).toFixed(2));
    const naiveMAE = parseFloat(avg(naiveErrors).toFixed(2));
    const smartMAE = parseFloat(avg(smartErrors).toFixed(2));

    const overallCalib = adapter.overallCalibration as Record<string, unknown>;

    return {
      success:           true,
      adapterVersion:    adapter.version as number,
      multiplier,
      naiveMultiplier:   parseFloat(naiveMultiplier.toFixed(4)),
      biasDirection:     overallCalib.direction as string,
      biasMagnitude:     overallCalib.magnitude as string,
      avgDeltaPct:       parseFloat(avg(deltasPct).toFixed(1)),
      trainingSize:      adapter.trainingSize as number,
      totalCompared:     n,
      rawMAE,
      rawWithin1Pct:     pct1(rawErrors),
      rawWithin2Pct:     pct2(rawErrors),
      naiveMAE,
      naiveWithin1Pct:   pct1(naiveErrors),
      smartMAE,
      smartWithin1Pct:   pct1(smartErrors),
      smartWithin2Pct:   pct2(smartErrors),
      smartImprovementPct: rawMAE > 0 ? parseFloat(((rawMAE - smartMAE) / rawMAE * 100).toFixed(1)) : 0,
      smartBetterCount:  rows.filter(r => r.improved).length,
      smartWorseCount:   rows.filter(r => r.adapterError > r.rawError).length,
      lowDensityCount:   lowDeltasPct.length,
      highDensityCount:  highDeltasPct.length,
      lowDensityBiasPct:  parseFloat(avg(lowDeltasPct).toFixed(1)),
      highDensityBiasPct: parseFloat(avg(highDeltasPct).toFixed(1)),
      samples:           rows.slice(0, 20),
    };
  } catch (err) {
    console.error('getAdapterComparison error:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// ── Live LLM vs Adapter comparison ───────────────────────────────────────────
// Same Kaggle dataset directory used by scripts/batch-analyze.js
const DATASET_IMAGE_DIR = 'C:/Users/jnyan/Downloads/archive/images';

const LIVE_COMPARISON_PROMPT = `You are an expert agricultural AI analyzing a real tomato farm image.

Analyze this tomato plant/fruit image carefully and return ONLY a JSON object with these exact fields:

{
  "healthStatus": "healthy" | "early_stress" | "moderate_disease" | "severe_infection",
  "fruitCount": number (count ALL visible tomatoes including partially visible ones),
  "brightnessScore": number 0-1,
  "estimatedOcclusion": number 0-1 (how much fruit is hidden by leaves),
  "imageSharpness": number 0-1
}

Return ONLY the JSON. No explanation.`;

export type LiveComparisonResult = {
  success: boolean;
  error?: string;
  filename?: string;
  imageUrl?: string;
  source?: 'live' | 'cached';
  rawPrediction?: number;
  adapterPrediction?: number;
  groundTruth?: number | null;
  adapterApplied?: boolean;
  finalMultiplier?: number;
  conditionAdjustment?: 'amplified' | 'reduced' | 'standard';
  explanation?: string;
  healthStatus?: string;
};

export async function runLiveAdapterComparison(filename: string): Promise<LiveComparisonResult> {
  if (!/^tomato\d+\.(png|jpg|jpeg)$/i.test(filename)) {
    return { success: false, error: 'Invalid filename.' };
  }

  try {
    await connectToDatabase();

    type Conditions = { estimatedOcclusion?: number; brightnessScore?: number; imageSharpness?: number };

    let rawPrediction: number | null = null;
    let imageConditions: Conditions = {};
    let healthStatus = '';
    let source: 'live' | 'cached' = 'live';

    // Try ONE live Groq vision call with a short time budget — falls back to
    // cached analysis if Groq is rate-limited (which it has been on the free tier).
    try {
      const imagePath = path.join(DATASET_IMAGE_DIR, filename);
      if (!fs.existsSync(imagePath)) throw new Error('Image not found on disk');

      const buf  = fs.readFileSync(imagePath);
      const ext  = path.extname(filename).toLowerCase().replace('.', '');
      const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
      const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;

      const groq = new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' });

      const completion = await Promise.race([
        groq.chat.completions.create({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          max_tokens: 512,
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: dataUrl } },
              { type: 'text',      text: LIVE_COMPARISON_PROMPT },
            ],
          }],
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('live call timed out')), 20000)),
      ]) as OpenAI.Chat.Completions.ChatCompletion;

      let raw = completion.choices[0]?.message?.content ?? '{}';
      const block = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || raw.match(/(\{[\s\S]*\})/);
      if (block) raw = block[1].trim();
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      if (typeof parsed.fruitCount !== 'number') throw new Error('No fruitCount in live response');

      rawPrediction = parsed.fruitCount;
      imageConditions = {
        estimatedOcclusion: parsed.estimatedOcclusion as number | undefined,
        brightnessScore:    parsed.brightnessScore    as number | undefined,
        imageSharpness:     parsed.imageSharpness     as number | undefined,
      };
      healthStatus = (parsed.healthStatus as string) ?? '';
      source = 'live';
    } catch {
      source = 'cached';
    }

    // Look up the image's historical record — used for ground truth always,
    // and as the fallback prediction source when the live call fails.
    const stored = await Interaction.findOne({
      flowType: 'plant-analysis',
      'inputData.filename': filename,
    }).sort({ createdAt: -1 }).lean() as Record<string, unknown> | null;

    if (rawPrediction === null) {
      if (!stored) return { success: false, error: 'Live AI call failed and no cached analysis exists for this image.' };
      const output = (stored.geminiOutput  ?? {}) as Record<string, unknown>;
      const meta   = (stored.imageMetadata ?? {}) as Record<string, unknown>;
      rawPrediction   = typeof output.fruitCount === 'number' ? output.fruitCount : 0;
      imageConditions = {
        estimatedOcclusion: meta.estimatedOcclusion as number | undefined,
        brightnessScore:    meta.brightnessScore    as number | undefined,
        imageSharpness:     meta.imageSharpness     as number | undefined,
      };
      healthStatus = (output.healthStatus as string) ?? '';
    }

    const groundTruth = stored
      ? (((stored.actualOutcome ?? {}) as Record<string, unknown>).actualValue as number | undefined) ?? null
      : null;

    const adapterResult = await applyMicroAdapter('plant-analysis', rawPrediction, imageConditions).catch(() => null);

    return {
      success:            true,
      filename,
      imageUrl:           `/api/dataset-image/${filename}`,
      source,
      rawPrediction,
      adapterPrediction:  adapterResult?.adapterApplied ? adapterResult.adjustedPrediction : rawPrediction,
      groundTruth,
      adapterApplied:     adapterResult?.adapterApplied ?? false,
      finalMultiplier:    adapterResult?.finalMultiplier,
      conditionAdjustment: adapterResult?.conditionAdjustment,
      explanation:        adapterResult?.explanation,
      healthStatus,
    };
  } catch (err) {
    console.error('runLiveAdapterComparison error:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// ── Autonomous Error Detection ─────────────────────────────────────────────────

export async function runAutonomousDetection(): Promise<{
  success: boolean;
  data?: AutonomousDetectionResult;
  error?: string;
}> {
  try {
    const data = await detectErrorsAutonomously();
    return { success: true, data };
  } catch (err) {
    console.error('runAutonomousDetection error:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

