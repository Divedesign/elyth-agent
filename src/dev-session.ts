import readline from 'node:readline';
import { McpClient } from './mcp-client.js';
import { Logger } from './logger.js';
import { buildPrompt } from './prompt/build-prompt.js';
import { createProvider } from './providers/index.js';
import { executeToolLoop } from './agent.js';
import type { AgentConfig } from './config.js';
import type { Message, ToolDefinition, LLMProvider } from './providers/types.js';

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
};

interface DevState {
  messages: Message[];
  tickCount: number;
  mcp: McpClient;
  tools: ToolDefinition[];
  provider: LLMProvider;
  systemPrompt: string;
  logger: Logger;
  config: AgentConfig;
  rl: readline.Interface;
  autoAbort: AbortController | null;
}

function formatNow(): string {
  return new Date().toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
}

function prompt(rl: readline.Interface): Promise<string> {
  return new Promise((resolve) => {
    rl.question(`${COLORS.cyan}dev>${COLORS.reset} `, resolve);
  });
}

async function handleTick(state: DevState): Promise<void> {
  state.tickCount++;
  console.log(`\n${COLORS.cyan}--- Tick #${state.tickCount} ---${COLORS.reset}`);

  state.messages.push({
    role: 'user',
    content: `現在時刻: ${formatNow()}\n行動手順に従い、ELYTHで1サイクルを実行してください。`,
  });

  const startTime = Date.now();
  state.logger.logTickStart(state.config.provider, state.config.model);
  const turns = await executeToolLoop(
    state.provider, state.systemPrompt, state.messages,
    state.tools, state.mcp, state.logger, state.config.maxTurns,
  );
  state.logger.logTickEnd(turns, Date.now() - startTime);
}

async function handleDialogue(state: DevState, input: string): Promise<void> {
  state.messages.push({
    role: 'user',
    content: `[開発者指示] ${input}`,
  });

  const turns = await executeToolLoop(
    state.provider, state.systemPrompt, state.messages,
    state.tools, state.mcp, state.logger, state.config.maxTurns,
  );

  // Print the last assistant message if it was a plain text response
  if (turns > 0) {
    const lastMsg = state.messages[state.messages.length - 1];
    if (lastMsg.role === 'assistant' && typeof lastMsg.content === 'string') {
      console.log(`\n${COLORS.magenta}agent>${COLORS.reset} ${lastMsg.content}\n`);
    }
  }
}

function interruptibleSleep(ms: number, abort: AbortController): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    abort.signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve(true);
    }, { once: true });
  });
}

async function handleAuto(state: DevState, intervalOverride?: number): Promise<void> {
  const interval = intervalOverride ?? state.config.interval;
  console.log(`\n${COLORS.green}自動モード開始${COLORS.reset}（間隔: ${interval}秒）。/stop で中断できます。\n`);

  state.autoAbort = new AbortController();

  // Pause readline and use a temporary one for /stop detection during sleep
  state.rl.pause();

  while (state.autoAbort && !state.autoAbort.signal.aborted) {
    try {
      await handleTick(state);
    } catch (err) {
      console.error(
        `${COLORS.red}tick失敗:${COLORS.reset}`,
        err instanceof Error ? err.message : err,
      );
    }

    if (state.autoAbort.signal.aborted) break;

    const nextTime = new Date(Date.now() + interval * 1000).toLocaleTimeString();
    console.log(`\n次のtick: ${nextTime}。/stop で中断できます。`);

    // Listen for /stop during sleep using a temporary readline
    const sleepRl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const abort = state.autoAbort;

    const lineHandler = (line: string) => {
      if (line.trim() === '/stop') {
        abort.abort();
      }
    };
    sleepRl.on('line', lineHandler);

    const interrupted = await interruptibleSleep(interval * 1000, abort);

    sleepRl.removeListener('line', lineHandler);
    sleepRl.close();

    if (interrupted) break;
  }

  state.autoAbort = null;
  state.rl.resume();
  console.log(`${COLORS.green}自動モード停止。${COLORS.reset}\n`);
}

function showTools(tools: ToolDefinition[]): void {
  console.log(`\n${COLORS.cyan}利用可能なツール (${tools.length}):${COLORS.reset}`);
  for (const tool of tools) {
    console.log(`  ${COLORS.yellow}${tool.name}${COLORS.reset} - ${tool.description}`);
  }
  console.log('');
}

function showHistory(messages: Message[]): void {
  console.log(`\n${COLORS.cyan}メッセージ履歴: ${messages.length} 件${COLORS.reset}`);
  const recent = messages.slice(-10);
  const offset = messages.length - recent.length;
  for (let i = 0; i < recent.length; i++) {
    const msg = recent[i];
    let preview: string;
    if (typeof msg.content === 'string') {
      const chars = Array.from(msg.content);
      preview = chars.slice(0, 100).join('');
      if (chars.length > 100) preview += '...';
    } else {
      const types = msg.content.map((b) => b.type);
      preview = `[${types.join(', ')}]`;
    }
    console.log(`  ${COLORS.dim}[${offset + i}]${COLORS.reset} ${msg.role}: ${preview}`);
  }
  console.log('');
}

function showHelp(): void {
  console.log(`
${COLORS.cyan}コマンド:${COLORS.reset}
  /tick              自律tickサイクルを1回実行
  /auto [間隔]       自動tickループを開始（デフォルト: 設定値）
  /stop              自動tickループを停止（自動モード中）
  /tools             利用可能なMCPツールを一覧表示
  /history           メッセージ履歴の概要を表示
  /clear             メッセージ履歴をクリア
  /help              このヘルプを表示
  /exit              切断して終了

${COLORS.cyan}テキスト入力:${COLORS.reset}
  コマンド以外の入力は開発者指示としてエージェントに送信されます。
  エージェントはMCPツールを使って応答できます。
`);
}

async function dispatch(state: DevState, input: string): Promise<boolean> {
  if (!input) return false;

  if (input.startsWith('/')) {
    const [cmd, ...args] = input.split(/\s+/);
    switch (cmd) {
      case '/tick':
        await handleTick(state);
        break;
      case '/auto': {
        const interval = args[0] ? parseInt(args[0], 10) : undefined;
        await handleAuto(state, interval);
        break;
      }
      case '/stop':
        console.log('自動モードではありません。');
        break;
      case '/tools':
        showTools(state.tools);
        break;
      case '/history':
        showHistory(state.messages);
        break;
      case '/clear':
        state.messages = [];
        console.log('メッセージ履歴をクリアしました。\n');
        break;
      case '/exit':
      case '/quit':
        return true;
      case '/help':
        showHelp();
        break;
      default:
        console.log(`不明なコマンド: ${cmd}。/help で利用可能なコマンドを確認できます。\n`);
    }
  } else {
    await handleDialogue(state, input);
  }

  return false;
}

export async function runDevSession(config: AgentConfig): Promise<void> {
  const logger = new Logger(config.logDir);
  const mcp = new McpClient();

  console.log('');
  console.log('========================================');
  console.log('  ELYTH Agent - 開発モード');
  console.log(`  プロバイダ: ${config.provider} (${config.model})`);
  console.log('  /help でコマンド一覧を表示');
  console.log('========================================');
  console.log('');

  console.log('MCPサーバーに接続中...');
  await mcp.connect(config.elythApiKey, config.elythApiBase);
  const tools = await mcp.getTools();
  console.log(`${COLORS.green}接続完了。${COLORS.reset} ${tools.length} 個のツールが利用可能。\n`);

  const provider = createProvider(config.provider, config.model, config.llmApiKey);
  const systemPrompt = buildPrompt(config.personaPath, config.rulesPath, config.systemBasePath);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const state: DevState = {
    messages: [],
    tickCount: 0,
    mcp,
    tools,
    provider,
    systemPrompt,
    logger,
    config,
    rl,
    autoAbort: null,
  };

  try {
    while (true) {
      const input = await prompt(rl);
      const shouldExit = await dispatch(state, input.trim());
      if (shouldExit) break;
    }
  } finally {
    rl.close();
    await mcp.disconnect();
    logger.close();
    console.log('開発セッションを終了しました。');
  }
}
