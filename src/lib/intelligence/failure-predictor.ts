import { connectToDatabase } from '@/lib/mongodb';
import Interaction from '@/lib/db/models/Interaction';
import DomainPattern from '@/lib/db/models/DomainPattern';
import type { FailurePrediction } from '@/lib/types';

const SAFE_DEFAULT: FailurePrediction = {
  probability: 0.15,
  riskLevel: 'low',
  reasons: [],
  recommendation: 'Conditions look good. Proceeding with prediction.',
  shouldProceed: true,
};

export async function predictFailureProbability(
  flowType: string,
  currentHour: number,
  inputMetadata: {
    hasImage: boolean;
    cropType?: string;
    imageSize?: number;
  }
): Promise<FailurePrediction> {
  try {
    await connectToDatabase();

    let probability = 0;
    const reasons: string[] = [];

    // Step 1 + 2: Load active patterns and score each type
    const patterns = await DomainPattern.find({
      flowType: flowType as 'plant-analysis' | 'yield-forecast',
      active: true,
    }).lean();

    for (const p of patterns) {
      if (p.patternType === 'time_based') {
        if (currentHour >= 18 || currentHour <= 6) {
          probability += 0.35;
          reasons.push(p.insight);
        }
      } else if (p.patternType === 'systematic_bias') {
        probability += 0.15;
        reasons.push(p.insight);
      } else if (p.patternType === 'confidence_unreliable') {
        const meta = p.metadata as { falseConfidenceRate?: number };
        if ((meta?.falseConfidenceRate ?? 0) > 0.3) {
          probability += 0.25;
          reasons.push(p.insight);
        }
      }
    }

    // Step 3: Historical failure rate — last 20 interactions for this flow
    const recent = await Interaction.find({
      flowType: flowType as 'plant-analysis' | 'yield-forecast' | 'market-price' | 'chat-assistant',
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    if (recent.length > 0) {
      const lowCount = recent.filter(i => i.confidence === 'low').length;
      const lowRate  = lowCount / recent.length;
      if (lowRate > 0.4) {
        probability += 0.20;
        reasons.push(
          `${Math.round(lowRate * 100)}% of the last ${recent.length} predictions had low confidence.`
        );
      }
    }

    // Step 4: Image size check
    if (inputMetadata.hasImage && inputMetadata.imageSize !== undefined) {
      if (inputMetadata.imageSize < 50 * 1024) {
        probability += 0.15;
        reasons.push('Small image size suggests poor quality or low resolution.');
      }
    }

    // Step 5: Base rate when no patterns exist
    if (patterns.length === 0 && probability === 0) {
      probability = 0.15;
    }

    // Cap at 0.95 — never return 1.0
    probability = Math.min(0.95, Math.round(probability * 100) / 100);

    // Step 6: Risk level
    const riskLevel: FailurePrediction['riskLevel'] =
      probability >= 0.6 ? 'high' : probability >= 0.3 ? 'medium' : 'low';

    // Step 7: Recommendation
    const recommendation =
      riskLevel === 'high'
        ? 'Image quality appears poor. Please retake in good daylight from directly above the plant.'
        : riskLevel === 'medium'
        ? 'Prediction may be less accurate. Please verify the result carefully.'
        : 'Conditions look good. Proceeding with prediction.';

    // Step 8: Proceed?
    const shouldProceed = probability < 0.7;

    return { probability, riskLevel, reasons, recommendation, shouldProceed };
  } catch {
    // Predictor must never crash the app — return the safe default
    return SAFE_DEFAULT;
  }
}
