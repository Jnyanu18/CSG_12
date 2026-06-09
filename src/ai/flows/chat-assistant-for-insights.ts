'use server';

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const ChatAssistantForInsightsInputSchema = z.object({
  query: z.string().describe('The user query about tomato yield, forecasts, or market prices.'),
  detectionResult: z.any().optional().describe('The JSON object containing the results from the plant detection model.'),
  forecastResult: z.any().optional().describe('The JSON object containing the yield forecast results.'),
  marketResult: z.any().optional().describe('The JSON object containing the market price forecast results.'),
});
export type ChatAssistantForInsightsInput = z.infer<typeof ChatAssistantForInsightsInputSchema>;

const ChatAssistantForInsightsOutputSchema = z.object({
  reply: z.string().describe('The reply from the chat assistant.'),
  confidence: z.enum(['high', 'medium', 'low']).describe(
    '"high": all required data present, clear question, direct answer available. "medium": partial data or some ambiguity. "low": critical data missing OR question outside available context.'
  ),
  uncertaintyType: z.enum(['data', 'domain', 'model']).describe(
    '"data": required analysis data not present in context (user has not run that analysis yet). "domain": question about unfamiliar agricultural practice. "model": genuinely uncertain, cannot determine reason (LAST RESORT only).'
  ),
  reasoning: z.string().describe(
    'One specific sentence explaining this reply and confidence level. Good: "Yield and market data both present, harvest timing answered by cross-referencing peak price date with harvest window, high confidence." Bad: "I answered the question."'
  ),
});
export type ChatAssistantForInsightsOutput = z.infer<typeof ChatAssistantForInsightsOutputSchema>;

export async function chatAssistantForInsights(input: ChatAssistantForInsightsInput): Promise<ChatAssistantForInsightsOutput> {
  return chatAssistantForInsightsFlow(input);
}

const chatPrompt = ai.definePrompt({
  name: 'chatAssistantForInsightsPrompt',
  input: { schema: ChatAssistantForInsightsInputSchema },
  output: { schema: ChatAssistantForInsightsOutputSchema, format: 'json' },
  prompt: `You are an expert agricultural chat assistant for the AgriVisionAI platform.
Provide clear, concise, and helpful insights based on the data provided.

{{#if detectionResult}}
**Plant Detection Analysis:**
\`\`\`json
{{json detectionResult}}
\`\`\`
{{/if}}

{{#if forecastResult}}
**Yield Forecast Analysis:**
\`\`\`json
{{json forecastResult}}
\`\`\`
{{/if}}

{{#if marketResult}}
**Market Price & Profit Analysis:**
\`\`\`json
{{json marketResult}}
\`\`\`
{{/if}}

**User's Question:** "{{query}}"

**Instructions:**
1. Answer the user's question directly using the provided JSON data.
2. If the data needed to answer the question is not present, politely state it is unavailable and suggest running the required analysis (e.g., "Please run a market forecast to get price predictions.").
3. Format numbers to two decimal places with units (e.g., kg, ₹, ₹/kg).
4. Keep answers brief and direct.

**Assess your confidence using these definitions:**
confidence:
- "high": all required data present in context, clear question, direct answer available
- "medium": partial data available or some ambiguity in the question
- "low": critical data missing OR question is outside the available context

uncertaintyType (primary reason for any uncertainty):
- "data": required analysis results not in context (user has not run that analysis yet)
- "domain": question about unfamiliar agricultural practice or situation beyond the data
- "model": genuinely uncertain, cannot determine reason (LAST RESORT only)

reasoning: one specific sentence explaining this reply and confidence level.
- Bad:  "I answered the question."
- Good: "Yield and market data both present, harvest timing answered by cross-referencing peak price date with harvest window, high confidence."

Return this exact JSON structure:
{
  "reply": "string — your answer to the user",
  "confidence": "high" | "medium" | "low",
  "uncertaintyType": "data" | "domain" | "model",
  "reasoning": "string — one specific sentence explaining reply and confidence"
}`,
});

const chatAssistantForInsightsFlow = ai.defineFlow(
  {
    name: 'chatAssistantForInsightsFlow',
    inputSchema: ChatAssistantForInsightsInputSchema,
    outputSchema: ChatAssistantForInsightsOutputSchema,
  },
  async (input) => {
    const { output } = await chatPrompt(input);
    if (!output) {
      throw new Error('The AI assistant failed to generate a reply.');
    }
    return output;
  }
);
