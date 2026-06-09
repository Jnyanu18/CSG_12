import { genkit } from 'genkit';
import OpenAI from 'openai';

const groqClient = new OpenAI({
  apiKey:  process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

export const ai = genkit({ model: 'groq/vision' });

ai.defineModel(
  {
    name: 'groq/vision',
    label: 'Llama 4 Scout 17B Vision (Groq)',
    supports: { media: true, multiturn: true, output: ['text', 'json'], tools: false, systemRole: true },
  },
  async (request) => {
    const messages = request.messages.map(msg => {
      const role = msg.role === 'model' ? 'assistant' as const : msg.role === 'user' ? 'user' as const : 'system' as const;
      const content = msg.content.map(part => {
        if ('media' in part && part.media) {
          return { type: 'image_url' as const, image_url: { url: part.media.url } };
        }
        return { type: 'text' as const, text: 'text' in part ? (part.text ?? '') : '' };
      });
      return { role, content };
    });

    const completion = await groqClient.chat.completions.create({
      model:      'meta-llama/llama-4-scout-17b-16e-instruct',
      messages:   messages as Parameters<typeof groqClient.chat.completions.create>[0]['messages'],
      max_tokens: 2048,
    });

    let text = completion.choices[0]?.message?.content ?? '';

    // Extract JSON block if model wrapped it in markdown or mixed with explanation
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
    if (jsonMatch) text = jsonMatch[1].trim();

    // If model echoed schema description instead of filling it, make a second focused call
    if (text.includes('"description":') && text.includes('"type":') && !text.includes('"plantType"') && !text.includes('"totalExpectedYieldKg"')) {
      const retry = await groqClient.chat.completions.create({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [
          ...messages as Parameters<typeof groqClient.chat.completions.create>[0]['messages'],
          { role: 'assistant', content: text },
          { role: 'user', content: 'You output the schema instead of filling it. Now output ONLY valid JSON with actual values. No explanation, no schema, just the JSON object with real data.' },
        ],
        max_tokens: 2048,
      });
      let retryText = retry.choices[0]?.message?.content ?? '';
      const retryMatch = retryText.match(/```(?:json)?\s*([\s\S]*?)```/) || retryText.match(/(\{[\s\S]*\})/);
      if (retryMatch) retryText = retryMatch[1].trim();
      text = retryText;
    }

    return {
      message:      { role: 'model', content: [{ text }] },
      finishReason: 'stop',
      usage: {
        inputTokens:  completion.usage?.prompt_tokens,
        outputTokens: completion.usage?.completion_tokens,
      },
    };
  },
);
