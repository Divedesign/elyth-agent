import { McpClient } from './mcp-client.js';
import { Logger } from './logger.js';
import { buildPrompt } from './prompt/build-prompt.js';
import { createProvider } from './providers/index.js';
import type { AgentConfig } from './config.js';
import type {
  Message,
  ContentBlock,
  ToolUseBlock,
  ToolResultBlock,
  ToolDefinition,
  LLMProvider,
} from './providers/types.js';

/**
 * Execute the LLM tool-use loop. Mutates the messages array in place.
 * Returns the number of turns consumed.
 */
export async function executeToolLoop(
  provider: LLMProvider,
  systemPrompt: string,
  messages: Message[],
  tools: ToolDefinition[],
  mcp: McpClient,
  logger: Logger,
  maxTurns: number,
): Promise<number> {
  let turns = 0;

  while (turns < maxTurns) {
    const res = await provider.chat(systemPrompt, messages, tools);
    turns++;
    logger.logResponse(res);

    if (res.stopReason !== 'tool_use' || res.toolCalls.length === 0) {
      if (res.content) {
        messages.push({ role: 'assistant', content: res.content });
      }
      break;
    }

    // Build assistant message with text + tool_use blocks
    const assistantBlocks: ContentBlock[] = [];
    if (res.content) {
      assistantBlocks.push({ type: 'text', text: res.content });
    }
    for (const call of res.toolCalls) {
      assistantBlocks.push({
        type: 'tool_use',
        id: call.id,
        name: call.name,
        input: call.input,
        metadata: call.metadata,
      } as ToolUseBlock);
    }
    messages.push({ role: 'assistant', content: assistantBlocks });

    // Execute tool calls and build result blocks
    const resultBlocks: ToolResultBlock[] = [];
    for (const call of res.toolCalls) {
      logger.logToolCall(call);
      try {
        const result = await mcp.callTool(call.name, call.input);
        logger.logToolResult(call, result);
        resultBlocks.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: result.content,
          is_error: result.isError,
        });
      } catch (err) {
        const errorMsg =
          err instanceof Error ? err.message : String(err);
        logger.logToolResult(call, {
          content: errorMsg,
          isError: true,
        });
        resultBlocks.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: errorMsg,
          is_error: true,
        });
      }
    }

    messages.push({ role: 'user', content: resultBlocks });
  }

  return turns;
}

export async function runTick(config: AgentConfig): Promise<void> {
  const logger = new Logger(config.logDir);
  const startTime = Date.now();

  try {
    logger.logTickStart(config.provider, config.model);

    // Connect to MCP
    const mcp = new McpClient();
    await mcp.connect(config.elythApiKey, config.elythApiBase);

    try {
      const tools = await mcp.getTools();
      const provider = createProvider(
        config.provider,
        config.model,
        config.llmApiKey,
      );
      const systemPrompt = buildPrompt(
        config.personaPath,
        config.rulesPath,
        config.systemBasePath,
      );

      const now = new Date().toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
      });

      const messages: Message[] = [
        {
          role: 'user',
          content: `現在時刻: ${now}\n行動手順に従い、ELYTHで1サイクルを実行してください。`,
        },
      ];

      const turns = await executeToolLoop(
        provider, systemPrompt, messages, tools, mcp, logger, config.maxTurns,
      );

      logger.logTickEnd(turns, Date.now() - startTime);
    } finally {
      await mcp.disconnect();
    }
  } catch (err) {
    logger.logError(err);
    throw err;
  } finally {
    logger.close();
  }
}
