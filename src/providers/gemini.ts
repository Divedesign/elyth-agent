import { GoogleGenAI, type Content, type Part } from '@google/genai';
import type {
  LLMProvider,
  LLMResponse,
  Message,
  ToolDefinition,
  ToolCall,
  ContentBlock,
} from './types.js';

export class GeminiProvider implements LLMProvider {
  private ai: GoogleGenAI;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  async chat(
    systemPrompt: string,
    messages: Message[],
    tools: ToolDefinition[],
  ): Promise<LLMResponse> {
    const geminiTools =
      tools.length > 0
        ? [
            {
              functionDeclarations: tools.map((t) => ({
                name: t.name,
                description: t.description,
                parametersJsonSchema: this.stripUnsupportedFields(t.inputSchema),
              })),
            },
          ]
        : undefined;

    const toolNameMap = this.buildToolNameMap(messages);
    const contents = this.convertMessages(messages, toolNameMap);

    const response = await this.ai.models.generateContent({
      model: this.model,
      contents,
      config: {
        systemInstruction: systemPrompt,
        tools: geminiTools,
      },
    });

    const textParts: string[] = [];
    const toolCalls: ToolCall[] = [];

    if (response.candidates?.[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
        // Skip thinking parts — only extract actual text
        if (part.text && !part.thought) {
          textParts.push(part.text);
        }
        if (part.functionCall) {
          const metadata: Record<string, unknown> = {};
          if (part.thoughtSignature) {
            metadata.thoughtSignature = part.thoughtSignature;
          }
          toolCalls.push({
            id: `gemini_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: part.functionCall.name!,
            input: (part.functionCall.args as Record<string, unknown>) || {},
            metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
          });
        }
      }
    }

    const finishReason = response.candidates?.[0]?.finishReason;
    let stopReason: LLMResponse['stopReason'];
    if (toolCalls.length > 0) {
      stopReason = 'tool_use';
    } else if (finishReason === 'MAX_TOKENS') {
      stopReason = 'max_tokens';
    } else {
      stopReason = 'end';
    }

    return {
      content: textParts.length > 0 ? textParts.join('\n') : null,
      toolCalls,
      stopReason,
    };
  }

  /** Recursively remove JSON Schema fields that Gemini API doesn't accept */
  private stripUnsupportedFields(obj: unknown): unknown {
    if (Array.isArray(obj)) {
      return obj.map((item) => this.stripUnsupportedFields(item));
    }
    if (obj !== null && typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      const UNSUPPORTED = new Set([
        '$schema', 'additionalProperties', '$id', '$ref',
        '$comment', '$defs', 'definitions',
      ]);
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        if (UNSUPPORTED.has(key)) continue;
        result[key] = this.stripUnsupportedFields(value);
      }
      return result;
    }
    return obj;
  }

  private convertMessages(
    messages: Message[],
    toolNameMap: Map<string, string>,
  ): Content[] {
    const contents: Content[] = [];

    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }],
        });
        continue;
      }

      const blocks = msg.content as ContentBlock[];

      // tool_result blocks must be sent as role 'user' with functionResponse parts
      const toolResults = blocks.filter((b) => b.type === 'tool_result');
      const otherBlocks = blocks.filter((b) => b.type !== 'tool_result');

      if (otherBlocks.length > 0) {
        const role = msg.role === 'assistant' ? 'model' : 'user';
        const parts: Part[] = [];
        for (const block of otherBlocks) {
          switch (block.type) {
            case 'text':
              parts.push({ text: block.text });
              break;
            case 'tool_use': {
              const fcPart: Part = {
                functionCall: {
                  name: block.name,
                  args: block.input,
                },
              };
              if (block.metadata?.thoughtSignature) {
                (fcPart as Record<string, unknown>).thoughtSignature =
                  block.metadata.thoughtSignature;
              }
              parts.push(fcPart);
              break;
            }
          }
        }
        if (parts.length > 0) {
          contents.push({ role, parts });
        }
      }

      if (toolResults.length > 0) {
        const frParts: Part[] = toolResults.map((block) => {
          if (block.type !== 'tool_result') throw new Error('unreachable');
          return {
            functionResponse: {
              name: toolNameMap.get(block.tool_use_id) ?? 'unknown',
              response: { result: block.content },
            },
          };
        });
        contents.push({ role: 'user', parts: frParts });
      }
    }

    return contents;
  }

  /** Scan all messages to build a tool_use_id → name mapping */
  private buildToolNameMap(messages: Message[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const msg of messages) {
      if (typeof msg.content === 'string') continue;
      for (const block of msg.content) {
        if (block.type === 'tool_use') {
          map.set(block.id, block.name);
        }
      }
    }
    return map;
  }
}
