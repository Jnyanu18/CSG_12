'use server';

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { YieldForecastInputSchema, YieldForecastOutputSchema, type YieldForecastInput, type YieldForecastOutput } from '@/lib/types';

// Extended input: today injected at runtime + optional domain context from actions.ts
const YieldForecastInputWithDateSchema = YieldForecastInputSchema.extend({
  today: z.string().describe("Today's date in YYYY-MM-DD format. All yieldCurve dates must start from this date."),
  domainContext: z.string().optional().describe(
    'Learned domain knowledge from past farmer corrections. Injected at runtime; not provided by the user.'
  ),
});

// Extend the base schema locally to add capture fields.
// confidence (number 0-1) and reasoning (string) already exist in YieldForecastOutputSchema.
// extractCaptureFields in actions.ts maps the numeric confidence to 'high'|'medium'|'low'.
const YieldForecastOutputWithCaptureSchema = YieldForecastOutputSchema.extend({
  uncertaintyType: z.enum(['data', 'domain', 'model']).describe(
    '"data": input analysis quality is the problem (few detections, ambiguous stages). "domain": unfamiliar crop growth pattern or variety. "model": genuinely uncertain, cannot determine reason (LAST RESORT only).'
  ),
});

const forecastPrompt = ai.definePrompt({
  name: 'yieldForecastPrompt',
  input: { schema: YieldForecastInputWithDateSchema },
  output: { schema: YieldForecastOutputWithCaptureSchema, format: 'json' },
  prompt: `You are an expert agricultural AI specializing in yield forecasting.
Predict the total yield and yield curve based on an initial plant analysis.

**Today's date: {{{today}}}**
IMPORTANT: All dates in the yieldCurve array must start from {{{today}}} and be consecutive YYYY-MM-DD dates forward in time.
{{#if domainContext}}

{{{domainContext}}}
{{/if}}

**Input Data:**
1. Plant Analysis:
   - Plant Type: {{{analysis.plantType}}}
   - Summary: {{{analysis.summary}}}
   - Stage Counts: {{json analysis.stages}}

2. Farming Controls:
   - Number of Plants: {{{controls.numPlants}}}
   - Average Fruit Weight (grams): {{{controls.avgWeightG}}}
   - Forecast Horizon (days): {{{controls.forecastDays}}}

**Instructions:**
1. Estimate total potential fruits by summing all stage counts.
2. Calculate total expected yield (kg): total fruits × average weight (g) × numPlants ÷ 1000.
3. Model the yield curve over {{{controls.forecastDays}}} days based on the stage distribution and standard growth cycles for {{{analysis.plantType}}}.
4. Assign a numeric confidence score (0.0–1.0):
   - Higher (0.8–0.95) if most fruit is in late stages (mature, ripening, pink).
   - Lower (0.4–0.65) if most fruit is in early stages (flower, fruitlet) or detection counts are very low.
5. Select uncertaintyType based on the PRIMARY reason for any uncertainty:
   - "data": input detection quality is the problem (very few detections, ambiguous stage classifications, incomplete analysis)
   - "domain": unfamiliar crop variety or growth pattern (detection looks fine, but growth cycle is uncertain)
   - "model": genuinely uncertain, cannot determine the reason (LAST RESORT only)
6. Write a specific reasoning sentence that explains the confidence score and uncertaintyType:
   - Bad:  "The forecast was calculated based on the input data."
   - Good: "Forecast based on 4 mature and 3 immature tomato fruits across 10 plants, confidence 0.88 because majority are in late stages with high maturity probability within the 14-day window, uncertaintyType data because detection count is low."

**Return this exact JSON structure:**
{
  "totalExpectedYieldKg": number,
  "yieldCurve": [{"date": "YYYY-MM-DD", "yieldKg": number}],
  "confidence": number between 0.0 and 1.0,
  "notes": "string — brief summary and important caveats",
  "reasoning": "string — specific sentence explaining the yield calculation, confidence score, and uncertaintyType choice",
  "uncertaintyType": "data" | "domain" | "model"
}`,
});

const forecastYieldFlow = ai.defineFlow(
  {
    name: 'forecastYieldFlow',
    inputSchema: YieldForecastInputWithDateSchema,
    outputSchema: YieldForecastOutputWithCaptureSchema,
  },
  async (input) => {
    const today = new Date().toISOString().slice(0, 10);
    const { output } = await forecastPrompt({ ...input, today });
    if (!output) {
      throw new Error('Yield forecast failed: No output from model.');
    }
    return output;
  }
);

export async function forecastYield(
  input: YieldForecastInput & { domainContext?: string }
): Promise<YieldForecastOutput> {
  return forecastYieldFlow({ ...input, today: new Date().toISOString().slice(0, 10) });
}
