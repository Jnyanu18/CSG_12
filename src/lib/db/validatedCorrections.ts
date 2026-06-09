import { connectToDatabase } from '@/lib/mongodb';
import ValidatedCorrection, { IValidatedCorrection } from '@/lib/db/models/ValidatedCorrection';
import type { CrossValidationResult } from '@/lib/types';

type SaveValidatedCorrectionData = {
  interactionId: string;
  flowType: string;
  predictedValue: number;
  correctedValue: number;
  cropType: string;
  conditions: {
    hourOfDay: number;
    confidence: string;
    uncertaintyType: string;
  };
  validation: CrossValidationResult;
};

export async function saveValidatedCorrection(
  data: SaveValidatedCorrectionData
): Promise<IValidatedCorrection> {
  await connectToDatabase();

  const delta = data.correctedValue - data.predictedValue;
  const deltaPercent =
    data.predictedValue !== 0
      ? Math.round((delta / data.predictedValue) * 10000) / 100
      : 0;

  const doc = await ValidatedCorrection.create({
    interactionId:  data.interactionId,
    flowType:       data.flowType,
    predictedValue: data.predictedValue,
    correctedValue: data.correctedValue,
    delta:          Math.round(delta * 100) / 100,
    deltaPercent,
    cropType:       data.cropType,
    conditions:     data.conditions,
    validation: {
      confidenceScore:    data.validation.confidenceScore,
      similarCorrections: data.validation.similarCorrections,
      consistencyScore:   data.validation.consistencyScore,
      recommendation:     data.validation.recommendation,
      validatedAt:        new Date(),
    },
    readyForTraining: data.validation.readyForTraining,
    usedInTraining:   false,
  });

  return doc;
}

export async function getTrainingReadyCorrections(
  flowType: string
): Promise<{ ready: boolean; corrections: IValidatedCorrection[]; count: number }> {
  await connectToDatabase();

  const corrections = await ValidatedCorrection.find({
    flowType,
    readyForTraining: true,
    usedInTraining:   false,
  })
    .lean()
    .exec() as unknown as IValidatedCorrection[];

  return { ready: corrections.length >= 10, corrections, count: corrections.length };
}

export async function markAsUsedInTraining(ids: string[], batchId: string): Promise<void> {
  await connectToDatabase();

  await ValidatedCorrection.updateMany(
    { _id: { $in: ids } },
    { usedInTraining: true, trainingBatchId: batchId }
  );
}
