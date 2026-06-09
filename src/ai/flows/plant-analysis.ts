'use server';

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { AnalyzePlantInputSchema, PlantAnalysisResultSchema, type AnalyzePlantInput, type PlantAnalysisResult } from '@/lib/types';

// Extends the public input with an optional domain-knowledge block injected by actions.ts
const AnalyzePlantInputWithDomainSchema = AnalyzePlantInputSchema.extend({
  domainContext: z.string().optional().describe(
    'Learned domain knowledge from past farmer corrections. Injected at runtime; not provided by the user.'
  ),
});

const PlantAnalysisOutputSchema = PlantAnalysisResultSchema.extend({
  brightnessScore: z.number().min(0).max(1).describe(
    '0.0 = very dark, 1.0 = very bright. Estimate from overall image exposure.'
  ),
  contrastScore: z.number().min(0).max(1).describe(
    '0.0 = flat/washed out, 1.0 = high contrast. Estimate from difference between light and dark areas.'
  ),
  estimatedOcclusion: z.number().min(0).max(1).describe(
    '0.0 = fruits fully visible, 1.0 = fruits completely hidden. Fraction of fruits partially or fully blocked from view.'
  ),
  imageSharpness: z.number().min(0).max(1).describe(
    '0.0 = very blurry, 1.0 = very sharp. Estimate from edge clarity.'
  ),
  imagingAngle: z.enum(['top', 'side', 'diagonal', 'close_up']).describe(
    '"top" = looking down at plant, "side" = looking horizontally, "diagonal" = angled view, "close_up" = very close shot.'
  ),
  lightingCondition: z.enum(['bright_natural', 'dim_natural', 'artificial', 'mixed', 'backlit']).describe(
    '"bright_natural" = sunny daylight, "dim_natural" = cloudy or shade, "artificial" = indoor lighting, "mixed" = combination, "backlit" = light behind subject.'
  ),
  backgroundClutter: z.enum(['low', 'medium', 'high']).describe(
    '"low" = clean simple background, "medium" = some visual noise, "high" = busy complex background.'
  ),
  confidence: z.enum(['high', 'medium', 'low']).describe(
    '"high": clear image, familiar plant, certain output. "medium": some ambiguity but reasonable. "low": poor image quality OR unfamiliar plant OR heavy uncertainty.'
  ),
  uncertaintyType: z.enum(['data', 'domain', 'model']).describe(
    '"data": image quality is the problem (blurry, dark, occluded). "domain": unfamiliar crop/variety/stage (image fine, knowledge lacking). "model": genuinely confused, cannot determine reason (LAST RESORT only).'
  ),
  reasoning: z.string().describe(
    'One specific sentence explaining this exact output and confidence level. Good: "Clear close-up of a tomato plant with 4 mature red fruits visible, high confidence due to excellent image clarity." Bad: "I analysed the image."'
  ),
});

const analysisPrompt = ai.definePrompt({
  name: 'plantAnalysisPrompt',
  input: { schema: AnalyzePlantInputWithDomainSchema },
  output: { schema: PlantAnalysisOutputSchema, format: 'json' },
  prompt: `You are an agricultural vision assistant.
Analyze the image of a plant and return a JSON object.
{{#if domainContext}}

{{{domainContext}}}
{{/if}}

Steps:
0. Analyze image quality and conditions FIRST, before counting fruits:
   - brightnessScore (0.0-1.0): Overall image exposure. 0 = very dark, 1 = very bright.
   - contrastScore (0.0-1.0): Difference between light and dark areas. 0 = flat/washed out, 1 = high contrast.
   - estimatedOcclusion (0.0-1.0): What fraction of fruits are partially or fully blocked from view. 0 = all visible, 1 = completely hidden.
   - imageSharpness (0.0-1.0): Edge clarity. 0 = very blurry, 1 = very sharp.
   - imagingAngle: "top" (camera looking down at plant), "side" (horizontal view), "diagonal" (angled view), or "close_up" (very close shot).
   - lightingCondition: "bright_natural" (sunny daylight), "dim_natural" (cloudy or shade), "artificial" (indoor lighting), "mixed" (combination of lighting types), or "backlit" (main light source is behind the subject).
   - backgroundClutter: "low" (clean simple background), "medium" (some visual noise), or "high" (busy complex background).

1. Identify the plant type (e.g., "Tomato", "Lemon").
2. Count and classify all visible fruits and flowers by growth stage. Scan the image systematically — left to right, top to bottom, foreground to background. Count partially visible or occluded fruits too; if you can see any part of a fruit, it counts. Do not under-count. For tomatoes use: flower, immature, breaker, ripening, pink, mature, overripened. For lemons use: flower, fruitlet, immature, mature.
3. Assess your confidence using these exact definitions:

   confidence:
   - "high": clear image, familiar plant, certain about output
   - "medium": some ambiguity but a reasonable estimate
   - "low": poor image quality OR unfamiliar plant OR heavy uncertainty

   uncertaintyType (select the PRIMARY reason for any uncertainty):
   - "data": image quality is the problem (blurry, dark, heavily occluded)
   - "domain": unfamiliar crop/variety/stage (image is fine, your knowledge is limited)
   - "model": genuinely confused, cannot determine reason (use as LAST RESORT only)

   reasoning: one specific sentence explaining this exact output and confidence level.
   - Bad:  "I analysed the image."
   - Good: "Clear close-up of a tomato plant with 4 visible mature red fruits and 3 green immature fruits, high confidence due to excellent image clarity and familiar plant type."

Return this exact JSON structure:
{
  "brightnessScore": number (0.0-1.0),
  "contrastScore": number (0.0-1.0),
  "estimatedOcclusion": number (0.0-1.0),
  "imageSharpness": number (0.0-1.0),
  "imagingAngle": "top" | "side" | "diagonal" | "close_up",
  "lightingCondition": "bright_natural" | "dim_natural" | "artificial" | "mixed" | "backlit",
  "backgroundClutter": "low" | "medium" | "high",
  "plantType": "string — identified plant name",
  "summary": "string — one-sentence summary of findings",
  "stages": [{ "stage": "string", "count": number }],
  "confidence": "high" | "medium" | "low",
  "uncertaintyType": "data" | "domain" | "model",
  "reasoning": "string — one specific sentence explaining output and confidence"
}

Photo: {{media url=photoDataUri contentType=contentType}}`,
});

const analyzePlantFlow = ai.defineFlow(
  {
    name: 'analyzePlantFlow',
    inputSchema: AnalyzePlantInputWithDomainSchema,
    outputSchema: PlantAnalysisOutputSchema,
  },
  async (input) => {
    const { output } = await analysisPrompt(input);
    if (!output) {
      throw new Error('Analysis failed: No output from model.');
    }
    return output;
  }
);

export async function analyzePlant(
  input: AnalyzePlantInput & { domainContext?: string }
): Promise<PlantAnalysisResult> {
  return analyzePlantFlow(input);
}
