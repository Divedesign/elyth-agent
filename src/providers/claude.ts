import Anthropic from '@anthropic-ai/sdk';
import type {
  LLMProvider,
  LLMResponse,
  Message,
  ToolDefinition,
  ContentBlock,
  ToolCall,
} from './types.js';

export class ClaudeProvider implements LLMProvider {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async chat(
    systemPrompt: string,
    messages: Message[],
    tools: ToolDefinition[],
  ): Promise<LLMResponse> {
    const anthropicMessages = messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: this.convertContent(m.content),
    }));

    const anthropicTools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
    }));

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: anthropicMessages,
      tools: anthropicTools.length > 0 ? anthropicTools : undefined,
    });

    const textParts: string[] = [];
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        textParts.push(block.text);
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
      }
    }

    let stopReason: LLMResponse['stopReason'];
    switch (response.stop_reason) {
      case 'tool_use':
        stopReason = 'tool_use';
        break;
      case 'max_tokens':
        stopReason = 'max_tokens';
        break;
      default:
        stopReason = 'end';
    }

    return {
      content: textParts.length > 0 ? textParts.join('\n') : null,
      toolCalls,
      stopReason,
    };
  }

  private convertContent(
    content: string | ContentBlock[],
  ): string | Anthropic.ContentBlockParam[] {
    if (typeof content === 'string') return content;

    return content.map((block) => {
      switch (block.type) {
        case 'text':
          return { type: 'text' as const, text: block.text };
        case 'tool_use':
          return {
            type: 'tool_use' as const,
            id: block.id,
            name: block.name,
            input: block.input,
          };
        case 'tool_result':
          return {
            type: 'tool_result' as const,
            tool_use_id: block.tool_use_id,
            content: block.content,
            is_error: block.is_error,
          };
      }
    });
  }
}
