import { connectToDatabase } from '@/lib/mongodb';
import Interaction from '@/lib/db/models/Interaction';
import type { IActualOutcome } from '@/lib/db/models/Interaction';

export async function recordOutcome(
  interactionId: string,
  actualValue: number
): Promise<{ predictedValue: number; errorMargin: number; accuracyPercent: number }> {
  await connectToDatabase();

  const interaction = await Interaction.findById(interactionId);
  if (!interaction) throw new Error(`Interaction ${interactionId} not found`);

  const output = interaction.geminiOutput as Record<string, unknown>;

  let predictedValue: number;
  let outcomeType: IActualOutcome['type'];

  if (interaction.flowType === 'yield-forecast') {
    predictedValue = (output.totalExpectedYieldKg as number) ?? 0;
    outcomeType = 'yield';
  } else if (interaction.flowType === 'market-price') {
    predictedValue = (output.bestPrice as number) ?? 0;
    outcomeType = 'market_price';
  } else {
    throw new Error(`Flow type '${interaction.flowType}' does not support outcome recording`);
  }

  const errorMargin = actualValue - predictedValue;
  const accuracyPercent =
    predictedValue > 0
      ? Math.max(0, 100 - (Math.abs(errorMargin) / predictedValue) * 100)
      : 0;

  const outcome: IActualOutcome = {
    type: outcomeType,
    predictedValue,
    actualValue,
    recordedAt: new Date(),
    errorMargin: Math.round(errorMargin * 100) / 100,
    accuracyPercent: Math.round(accuracyPercent * 100) / 100,
  };

  await Interaction.findByIdAndUpdate(interactionId, { actualOutcome: outcome });

  return { predictedValue, errorMargin: outcome.errorMargin, accuracyPercent: outcome.accuracyPercent };
}

export async function getAccuracyMetrics() {
  await connectToDatabase();

  const [totalYield, totalMarket, withOutcome] = await Promise.all([
    Interaction.countDocuments({ flowType: 'yield-forecast' }),
    Interaction.countDocuments({ flowType: 'market-price' }),
    Interaction.find({ actualOutcome: { $exists: true } }).lean(),
  ]);

  const yieldDocs = withOutcome.filter(i => i.flowType === 'yield-forecast');
  const marketDocs = withOutcome.filter(i => i.flowType === 'market-price');

  function summarize(
    totalPredictions: number,
    docs: typeof withOutcome
  ) {
    const totalWithOutcomes = docs.length;
    if (totalWithOutcomes === 0) {
      return { totalPredictions, totalWithOutcomes: 0, averageErrorMargin: 0, averageAccuracyPercent: 0 };
    }
    const outcomes = docs.map(d => d.actualOutcome as IActualOutcome);
    const avgError = outcomes.reduce((s, o) => s + o.errorMargin, 0) / totalWithOutcomes;
    const avgAccuracy = outcomes.reduce((s, o) => s + o.accuracyPercent, 0) / totalWithOutcomes;
    return {
      totalPredictions,
      totalWithOutcomes,
      averageErrorMargin: Math.round(avgError * 100) / 100,
      averageAccuracyPercent: Math.round(avgAccuracy * 100) / 100,
    };
  }

  return {
    yieldForecast: summarize(totalYield, yieldDocs),
    marketPrice: summarize(totalMarket, marketDocs),
  };
}

export async function getImprovementOverTime() {
  await connectToDatabase();

  const interactions = await Interaction.find({ actualOutcome: { $exists: true } })
    .sort({ createdAt: 1 })
    .lean();

  const BATCH_SIZE = 20;
  const batches: {
    batch: number;
    accuracyPercent: number;
    count: number;
    flowTypes: string[];
  }[] = [];

  for (let i = 0; i < interactions.length; i += BATCH_SIZE) {
    const slice = interactions.slice(i, i + BATCH_SIZE);
    const outcomes = slice.map(d => d.actualOutcome as IActualOutcome);
    const avgAccuracy = outcomes.reduce((s, o) => s + o.accuracyPercent, 0) / slice.length;
    batches.push({
      batch: Math.floor(i / BATCH_SIZE) + 1,
      accuracyPercent: Math.round(avgAccuracy * 100) / 100,
      count: slice.length,
      flowTypes: [...new Set(slice.map(d => d.flowType))],
    });
  }

  return batches;
}
