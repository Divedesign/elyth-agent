import OpenAI from 'openai';
import type {
  LLMProvider,
  LLMResponse,
  Message,
  ToolDefinition,
  ToolCall,
  ContentBlock,
} from './types.js';

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async chat(
    systemPrompt: string,
    messages: Message[],
    tools: ToolDefinition[],
  ): Promise<LLMResponse> {
    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...messages.flatMap((m) => this.convertMessage(m)),
    ];

    const openaiTools: OpenAI.ChatCompletionTool[] | undefined =
      tools.length > 0
        ? tools.map((t) => ({
            type: 'function' as const,
            function: {
              name: t.name,
              description: t.description,
              parameters: t.inputSchema,
            },
          }))
        : undefined;

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: openaiMessages,
      tools: openaiTools,
      max_completion_tokens: 4096,
    });

    const choice = response.choices[0];
    const message = choice.message;

    const toolCalls: ToolCall[] = (message.tool_calls || []).map(
      (tc) => ({
        id: tc.id,
        name: tc.function.name,
        input: (() => {
          try { return JSON.parse(tc.function.arguments); }
          catch { return { _raw: tc.function.arguments }; }
        })(),
      }),
    );

    let stopReason: LLMResponse['stopReason'];
    if (choice.finish_reason === 'tool_calls') {
      stopReason = 'tool_use';
    } else if (choice.finish_reason === 'length') {
      stopReason = 'max_tokens';
    } else {
      stopReason = 'end';
    }

    return {
      content: message.content || null,
      toolCalls,
      stopReason,
    };
  }

  /** Convert one internal Message into one or more OpenAI messages.
   *  A user message containing multiple tool_results expands to
   *  one `role: 'tool'` message per result (OpenAI requirement). */
  private convertMessage(
    msg: Message,
  ): OpenAI.ChatCompletionMessageParam[] {
    if (typeof msg.content === 'string') {
      return [{ role: msg.role, content: msg.content }];
    }

    const blocks = msg.content as ContentBlock[];

    if (msg.role === 'user') {
      // Tool results → one 'tool' message per result
      const toolResults = blocks.filter((b) => b.type === 'tool_result');
      if (toolResults.length > 0) {
        return toolResults.map((b) => {
          if (b.type !== 'tool_result') throw new Error('unreachable');
          return {
            role: 'tool' as const,
            tool_call_id: b.tool_use_id,
            content: b.content,
          };
        });
      }
      // Fallback: concatenate text blocks
      const text = blocks
        .filter((b) => b.type === 'text')
        .map((b) => (b as { type: 'text'; text: string }).text)
        .join('\n');
      return [{ role: 'user', content: text }];
    }

    // Assistant message with tool_use blocks
    const text = blocks
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('\n');

    const toolUses = blocks.filter((b) => b.type === 'tool_use');
    if (toolUses.length > 0) {
      return [
        {
          role: 'assistant',
          content: text || null,
          tool_calls: toolUses.map((b) => {
            if (b.type !== 'tool_use') throw new Error('unreachable');
            return {
              id: b.id,
              type: 'function' as const,
              function: {
                name: b.name,
                arguments: JSON.stringify(b.input),
              },
            };
          }),
        },
      ];
    }

    return [{ role: 'assistant', content: text }];
  }
}
