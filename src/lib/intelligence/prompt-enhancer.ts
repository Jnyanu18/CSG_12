import { connectToDatabase } from '@/lib/mongodb';
import DomainPattern from '@/lib/db/models/DomainPattern';

export async function enhancePromptWithDomainKnowledge(
  flowType: string,
  currentHour: number
): Promise<string> {
  await connectToDatabase();

  const patterns = await DomainPattern.find({
    flowType: flowType as 'plant-analysis' | 'yield-forecast',
    active: true,
  }).lean();
  if (patterns.length === 0) return '';

  const relevant = patterns.filter(p => {
    if (p.patternType === 'time_based') {
      // Only inject time-based warning when the farmer is actually in that window
      return currentHour >= 18 || currentHour <= 6;
    }
    // systematic_bias and confidence_unreliable are always applicable
    return true;
  });

  if (relevant.length === 0) return '';

  return [
    'DOMAIN KNOWLEDGE FROM PAST FARMER INTERACTIONS:',
    relevant.map(p => `- ${p.insight}`).join('\n'),
    '',
    'Apply this farm-specific knowledge when generating your response.',
    'Consider these learned patterns as higher priority than general knowledge.',
  ].join('\n');
}
