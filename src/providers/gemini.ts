import {
  GoogleGenerativeAI,
  type Content,
  type FunctionDeclarationSchema,
  type Part,
} from '@google/generative-ai';
import type {
  LLMProvider,
  LLMResponse,
  Message,
  ToolDefinition,
  ToolCall,
  ContentBlock,
} from './types.js';

export class GeminiProvider implements LLMProvider {
  private genAI: GoogleGenerativeAI;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
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
                parameters: this.convertSchema(t.inputSchema),
              })),
            },
          ]
        : undefined;

    const model = this.genAI.getGenerativeModel({
      model: this.model,
      systemInstruction: systemPrompt,
      tools: geminiTools,
    });

    const toolNameMap = this.buildToolNameMap(messages);
    const lastMessage = messages[messages.length - 1];
    const lastHasFunctionResponse =
      Array.isArray(lastMessage.content) &&
      lastMessage.content.some((b) => (b as ContentBlock).type === 'tool_result');

    let result;
    if (lastHasFunctionResponse) {
      // sendMessage assumes role 'user', but functionResponse needs role 'function'.
      // Include all messages in history and use sendMessage with empty-ish prompt
      // to trigger the model to continue.
      const geminiHistory = this.convertMessages(messages);
      const chat = model.startChat({ history: geminiHistory });
      result = await chat.sendMessage('Continue based on the tool results above.');
    } else {
      const geminiHistory = this.convertMessages(messages.slice(0, -1));
      const chat = model.startChat({ history: geminiHistory });
      const lastParts = this.messageToParts(lastMessage, toolNameMap);
      result = await chat.sendMessage(lastParts);
    }

    const response = result.response;
    const candidate = response.candidates?.[0];

    const textParts: string[] = [];
    const toolCalls: ToolCall[] = [];

    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.text) {
          textParts.push(part.text);
        }
        if (part.functionCall) {
          const rawPart = part as unknown as Record<string, unknown>;
          const metadata: Record<string, unknown> = {};
          // Preserve thought_signature for Gemini conversation history
          if (rawPart.thoughtSignature) {
            metadata.thoughtSignature = rawPart.thoughtSignature;
          }
          toolCalls.push({
            id: `gemini_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: part.functionCall.name,
            input: (part.functionCall.args as Record<string, unknown>) || {},
            metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
          });
        }
      }
    }

    const finishReason = candidate?.finishReason;
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

  private convertSchema(
    schema: Record<string, unknown>,
  ): FunctionDeclarationSchema {
    return this.stripUnsupportedFields(schema) as FunctionDeclarationSchema;
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

  private convertMessages(messages: Message[]): Content[] {
    // Build a mapping of tool_use_id → function name from all messages
    const toolNameMap = this.buildToolNameMap(messages);

    return messages.map((m) => {
      let role: string;
      if (m.role === 'assistant') {
        role = 'model';
      } else if (
        Array.isArray(m.content) &&
        m.content.some((b) => (b as ContentBlock).type === 'tool_result')
      ) {
        // Gemini requires functionResponse parts to have role 'function'
        role = 'function';
      } else {
        role = 'user';
      }
      return { role, parts: this.messageToParts(m, toolNameMap) };
    });
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

  private messageToParts(
    msg: Message,
    toolNameMap: Map<string, string> = new Map(),
  ): Part[] {
    if (typeof msg.content === 'string') {
      return [{ text: msg.content }];
    }

    const blocks = msg.content as ContentBlock[];
    const parts: Part[] = [];

    for (const block of blocks) {
      switch (block.type) {
        case 'text':
          parts.push({ text: block.text });
          break;
        case 'tool_use': {
          const fcPart: Record<string, unknown> = {
            functionCall: {
              name: block.name,
              args: block.input,
            },
          };
          // Restore thought_signature if preserved
          if (block.metadata?.thoughtSignature) {
            fcPart.thoughtSignature = block.metadata.thoughtSignature;
          }
          parts.push(fcPart as unknown as Part);
          break;
        }
        case 'tool_result':
          parts.push({
            functionResponse: {
              name: toolNameMap.get(block.tool_use_id) ?? 'unknown',
              response: { result: block.content },
            },
          });
          break;
      }
    }

    return parts.length > 0 ? parts : [{ text: '' }];
  }
}
