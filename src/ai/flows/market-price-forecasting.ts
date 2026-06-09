'use server';

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const MarketPriceForecastingInputSchema = z.object({
  district: z.string().optional().describe('The district for which to forecast market prices.'),
  daysAhead: z.number().describe('The number of days ahead to forecast.'),
  readyKg: z.number().optional().describe('Amount of produce ready for harvest in kilograms.'),
});
export type MarketPriceForecastingInput = z.infer<typeof MarketPriceForecastingInputSchema>;

const MarketPriceForecastingInputWithDateSchema = MarketPriceForecastingInputSchema.extend({
  today: z.string().describe("Today's date in YYYY-MM-DD format. All forecast dates must start from this date."),
});

const MarketPriceForecastingOutputSchema = z.object({
  forecast: z.array(z.object({
    date: z.string(),
    price: z.number(),
  })).describe('A list of forecasted market prices for each day.'),
  bestDate: z.string().describe('The best date to sell for maximum profit.'),
  bestPrice: z.number().describe('The forecasted price on the best sell date.'),
  modelInfo: z.object({
    modelName: z.string(),
  }).describe('Information about the forecasting model used.'),
  confidence: z.enum(['high', 'medium', 'low']).describe(
    '"high": well-known district with stable patterns, clear price trend. "medium": some uncertainty in market conditions or data. "low": unknown district OR insufficient data OR highly volatile market.'
  ),
  uncertaintyType: z.enum(['data', 'domain', 'model']).describe(
    '"data": insufficient or unreliable market data for this district/period. "domain": unfamiliar market conditions or crop pricing dynamics. "model": genuinely uncertain, cannot determine reason (LAST RESORT only).'
  ),
  reasoning: z.string().describe(
    'One specific sentence explaining this forecast and confidence level. Good: "Coimbatore tomato prices historically rise post-monsoon, medium confidence due to reliance on simulated patterns rather than live data." Bad: "I generated a forecast."'
  ),
});
export type MarketPriceForecastingOutput = z.infer<typeof MarketPriceForecastingOutputSchema>;

export async function marketPriceForecasting(input: MarketPriceForecastingInput): Promise<MarketPriceForecastingOutput> {
  return marketPriceForecastingFlow(input);
}

const marketForecastPrompt = ai.definePrompt({
  name: 'marketForecastPrompt',
  input: { schema: MarketPriceForecastingInputWithDateSchema },
  output: { schema: MarketPriceForecastingOutputSchema, format: 'json' },
  prompt: `You are an expert in agricultural economics specializing in market price forecasting.

Input:
- Today's date: {{{today}}}
- District: {{{district}}}
- Forecast horizon: {{{daysAhead}}} days
- Produce ready for harvest: {{{readyKg}}} kg (if provided)

Task: Forecast daily market prices for tomatoes in the specified district for the next {{{daysAhead}}} days, starting from {{{today}}}.
IMPORTANT: All "date" fields in the forecast array must start from {{{today}}} and be consecutive YYYY-MM-DD dates forward in time.
If readyKg is provided, identify the best sell date for maximum profit.

Assess your confidence using these definitions:
confidence:
- "high": well-known district with stable, predictable market patterns and clear price trend
- "medium": some uncertainty in market conditions, partial data, or moderate price volatility
- "low": unknown district OR insufficient historical data OR highly unpredictable market

uncertaintyType (primary reason for any uncertainty):
- "data": insufficient or unreliable market data for this district or forecast period
- "domain": unfamiliar market/crop pricing dynamics or regional conditions
- "model": genuinely uncertain, cannot determine the reason (LAST RESORT only)

reasoning: one specific sentence explaining this forecast and confidence level.
- Bad:  "I generated a forecast."
- Good: "Coimbatore tomato prices historically increase in the Oct-Nov post-monsoon season, medium confidence due to reliance on simulated regional patterns rather than live market feed data."

Return this exact JSON structure:
{
  "forecast": [{"date": "YYYY-MM-DD", "price": number}],
  "bestDate": "YYYY-MM-DD",
  "bestPrice": number,
  "modelInfo": {"modelName": "string describing the model or approach used"},
  "confidence": "high" | "medium" | "low",
  "uncertaintyType": "data" | "domain" | "model",
  "reasoning": "string — one specific sentence explaining forecast and confidence"
}`,
});

const marketPriceForecastingFlow = ai.defineFlow(
  {
    name: 'marketPriceForecastingFlow',
    inputSchema: MarketPriceForecastingInputSchema,
    outputSchema: MarketPriceForecastingOutputSchema,
  },
  async (input) => {
    const today = new Date().toISOString().slice(0, 10);
    const result = await marketForecastPrompt({ ...input, today });
    if (!result.output) {
      throw new Error('The AI model failed to generate a market price forecast.');
    }
    return result.output;
  }
);
