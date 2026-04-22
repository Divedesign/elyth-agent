import type { LLMProvider } from './types.js';
import { ClaudeProvider } from './claude.js';
import { OpenAIProvider } from './openai.js';
import { GeminiProvider } from './gemini.js';

export function createProvider(
  provider: 'claude' | 'openai' | 'gemini',
  model: string,
  apiKey: string,
  baseURL?: string,
): LLMProvider {
  switch (provider) {
    case 'claude':
      return new ClaudeProvider(apiKey, model);
    case 'openai':
      return new OpenAIProvider(apiKey, model, baseURL);
    case 'gemini':
      return new GeminiProvider(apiKey, model);
  }
}
