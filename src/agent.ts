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

/** 一時的な参照用ツール — 使用後にクリアしてよい */
const CLEARABLE_TOOLS = new Set([
  'get_thread',
  'like_post',
  'unlike_post',
  'follow_vtuber',
  'unfollow_vtuber',
  'mark_notifications_read',
  'create_post',
  'create_reply',
]);

/**
 * 一時的なツール結果をクリアする。
 * CLEARABLE_TOOLSに該当し、かつ直近keepRecent件より古い結果を[Cleared]に置換。
 * get_my_posts, get_notifications, get_timelineの結果は全ステップで参照するため保持。
 */
function compactOlderToolResults(messages: Message[], keepRecent: number = 1): void {
  let clearableSetsFound = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'user' || typeof msg.content === 'string') continue;

    const hasToolResult = msg.content.some(b => b.type === 'tool_result');
    if (!hasToolResult) continue;

    const toolResults = msg.content.filter(b => b.type === 'tool_result') as ToolResultBlock[];
    const allClearable = toolResults.every(tr => {
      const toolName = findToolName(messages, tr.tool_use_id);
      return toolName !== null && CLEARABLE_TOOLS.has(toolName);
    });

    if (!allClearable) continue;

    clearableSetsFound++;
    if (clearableSetsFound > keepRecent) {
      for (const block of msg.content) {
        if (block.type === 'tool_result' && !block.is_error) {
          block.content = '[Cleared]';
        }
      }
    }
  }
}

/** tool_use_idに対応するツール名をメッセージ履歴から逆引きする */
function findToolName(messages: Message[], toolUseId: string): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'assistant' || typeof msg.content === 'string') continue;
    for (const block of msg.content) {
      if (block.type === 'tool_use' && block.id === toolUseId) {
        return block.name;
      }
    }
  }
  return null;
}

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

    // 古いtool_resultをクリアしてコンテキスト膨張を抑制
    compactOlderToolResults(messages);
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
