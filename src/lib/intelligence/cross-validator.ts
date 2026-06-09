import { connectToDatabase } from '@/lib/mongodb';
import Interaction from '@/lib/db/models/Interaction';
import type { CrossValidationResult } from '@/lib/types';
import mongoose from 'mongoose';

type NewCorrection = {
  interactionId: string;
  flowType: string;
  predictedValue: number;
  correctedValue: number;
  cropType: string;
  imageMetadata?: Record<string, unknown>;
  conditions: {
    hourOfDay: number;
    confidence: string;
    uncertaintyType: string;
  };
};

const SAFE_PENDING: CrossValidationResult = {
  isValid: true,
  confidenceScore: 0.3,
  validationReason: 'Validation unavailable — correction saved.',
  similarCorrections: 0,
  consistencyScore: 0,
  recommendation: 'pending',
  readyForTraining: false,
};

function extractPredictedValue(
  geminiOutput: Record<string, unknown>,
  flowType: string
): number {
  if (flowType === 'yield-forecast') {
    return typeof geminiOutput.totalExpectedYieldKg === 'number'
      ? geminiOutput.totalExpectedYieldKg
      : 0;
  }
  if (flowType === 'market-price') {
    return typeof geminiOutput.bestPrice === 'number' ? geminiOutput.bestPrice : 0;
  }
  return 0;
}

function computeImageSimilarityScore(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): number {
  if (!a || !b) return 0;

  let score = 0;

  const brightA = typeof a.brightnessScore === 'number' ? a.brightnessScore : 0.5;
  const brightB = typeof b.brightnessScore === 'number' ? b.brightnessScore : 0.5;
  if (Math.abs(brightA - brightB) <= 0.2) score += 0.2;

  const contA = typeof a.contrastScore === 'number' ? a.contrastScore : 0.5;
  const contB = typeof b.contrastScore === 'number' ? b.contrastScore : 0.5;
  if (Math.abs(contA - contB) <= 0.2) score += 0.15;

  const occA = typeof a.estimatedOcclusion === 'number' ? a.estimatedOcclusion : 0.5;
  const occB = typeof b.estimatedOcclusion === 'number' ? b.estimatedOcclusion : 0.5;
  if (Math.abs(occA - occB) <= 0.2) score += 0.3;

  const sharpA = typeof a.imageSharpness === 'number' ? a.imageSharpness : 0.5;
  const sharpB = typeof b.imageSharpness === 'number' ? b.imageSharpness : 0.5;
  if (Math.abs(sharpA - sharpB) <= 0.2) score += 0.15;

  if (a.imagingAngle && a.imagingAngle === b.imagingAngle) score += 0.1;
  if (a.lightingCondition && a.lightingCondition === b.lightingCondition) score += 0.1;

  return Math.round(score * 100) / 100;
}

export async function crossValidateCorrection(
  newCorrection: NewCorrection
): Promise<CrossValidationResult> {
  try {
    await connectToDatabase();

    const currentDelta = newCorrection.correctedValue - newCorrection.predictedValue;

    // Step 1: Fetch last 50 interactions of same flowType that have a farmerCorrection
    const candidates = await Interaction.find({
      flowType: newCorrection.flowType as
        | 'plant-analysis'
        | 'yield-forecast'
        | 'market-price'
        | 'chat-assistant',
      'farmerCorrection.correctedValue': { $exists: true },
      _id: { $ne: new mongoose.Types.ObjectId(newCorrection.interactionId) },
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    // Filter by cropType match and hourOfDay within ±3 h (wraps midnight)
    const timeSimilar = candidates.filter(doc => {
      const output = doc.geminiOutput as Record<string, unknown>;
      const docCropType =
        (output.plantType as string | undefined) ??
        (output.cropType as string | undefined) ??
        '';

      const cropMatch =
        docCropType.toLowerCase() === newCorrection.cropType.toLowerCase();

      const docHour = new Date(doc.createdAt).getHours();
      const rawDiff = Math.abs(docHour - newCorrection.conditions.hourOfDay);
      const hourMatch = Math.min(rawDiff, 24 - rawDiff) <= 3;

      return cropMatch && hourMatch;
    });

    // Step 2: Apply image similarity filtering if the new correction has metadata
    let similar = timeSimilar;
    let metadataFallback = false;

    if (newCorrection.imageMetadata) {
      const scored = timeSimilar.map(doc => ({
        doc,
        score: computeImageSimilarityScore(
          newCorrection.imageMetadata,
          (doc as unknown as Record<string, unknown>).imageMetadata as Record<string, unknown> | undefined,
        ),
      }));

      const meetingThreshold = scored.filter(s => s.score >= 0.5);

      if (meetingThreshold.length === 0 && timeSimilar.length > 0) {
        // No visually similar interactions — fall back to time-based only
        metadataFallback = true;
        similar = timeSimilar;
      } else {
        similar = meetingThreshold.map(s => s.doc);
      }
    }

    const totalSimilar = similar.length;

    // Empty database — insufficient data
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

    // Step 3: Compute deltas and count consistent corrections
    let consistentCount = 0;

    for (const doc of similar) {
      const correctedVal = doc.farmerCorrection?.correctedValue;
      if (typeof correctedVal !== 'number') continue;

      const predictedVal = extractPredictedValue(
        doc.geminiOutput as Record<string, unknown>,
        doc.flowType
      );
      const delta = correctedVal - predictedVal;

      const sameDirection =
        (delta > 0 && currentDelta > 0) || (delta < 0 && currentDelta < 0);

      const magnitudeDeviation =
        Math.abs(currentDelta) > 0
          ? Math.abs(Math.abs(delta) - Math.abs(currentDelta)) / Math.abs(currentDelta)
          : 1;

      if (sameDirection && magnitudeDeviation <= 0.4) consistentCount++;
    }

    const consistencyScore =
      Math.round((consistentCount / totalSimilar) * 100) / 100;

    // Step 4: Confidence score
    let confidenceScore: number;
    if (totalSimilar >= 5) {
      confidenceScore = consistencyScore;
    } else if (totalSimilar >= 2) {
      confidenceScore = Math.round(consistencyScore * 0.7 * 100) / 100;
    } else {
      confidenceScore = 0.3;
    }

    // Apply metadata fallback penalty: reduce confidence by 0.2 when visual similarity unavailable
    if (metadataFallback) {
      confidenceScore = Math.max(0, Math.round((confidenceScore - 0.2) * 100) / 100);
    }

    // Step 5: Recommendation
    let recommendation: CrossValidationResult['recommendation'];
    let isValid: boolean;
    let readyForTraining: boolean;
    let validationReason: string;

    if (metadataFallback) {
      recommendation = 'pending';
      isValid = true;
      readyForTraining = false;
      validationReason =
        'No visually similar interactions found. Pattern based on time conditions only.';
    } else if (confidenceScore >= 0.7) {
      recommendation = 'accept';
      isValid = true;
      readyForTraining = true;
      validationReason = `Consistent with ${consistentCount} similar correction${consistentCount !== 1 ? 's' : ''}.`;
    } else if (confidenceScore >= 0.4) {
      recommendation = 'pending';
      isValid = true;
      readyForTraining = false;
      validationReason = 'Insufficient similar corrections to validate.';
    } else {
      recommendation = 'reject';
      isValid = false;
      readyForTraining = false;
      validationReason = 'Contradicts existing correction patterns.';
    }

    return {
      isValid,
      confidenceScore,
      validationReason,
      similarCorrections: totalSimilar,
      consistencyScore,
      recommendation,
      readyForTraining,
    };
  } catch {
    return SAFE_PENDING;
  }
}
