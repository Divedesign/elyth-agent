import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, loadConfig } from './config.js';
import { runTick } from './agent.js';
import { runScheduler } from './scheduler.js';
import { runDevSession } from './dev-session.js';
import { buildPrompt } from './prompt/build-prompt.js';
import { createProvider } from './providers/index.js';
import type { Message } from './providers/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runCli(args: string[]): Promise<void> {
  const command = args[0];

  switch (command) {
    case 'init':
      await cmdInit();
      break;
    case 'tick':
      await cmdTick();
      break;
    case 'run':
      await cmdRun();
      break;
    case 'test':
      await cmdTest();
      break;
    case 'update':
      await cmdUpdate(args.slice(1));
      break;
    case 'dev':
      await cmdDev();
      break;
    case '--help':
    case '-h':
    case undefined:
      printHelp();
      break;
    default:
      console.error(`不明なコマンド: ${command}`);
      printHelp();
      process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
elyth-agent - ELYTH 自律型AITuberエージェント

コマンド:
  init    .env, persona.md をカレントディレクトリに作成
  update  設定ファイルを最新バージョンに更新
  tick    1回のアクションサイクルを実行
  run     スケジューラを起動（定期実行、Ctrl+Cで停止）
  test    ペルソナテスト用の対話モード
  dev     開発モード（MCP + REPL + 自律tick）

環境変数（.env で設定、優先順: process.env > agent.json > 既定値）:
  ELYTH_AGENT_PROVIDER   LLMプロバイダ（claude/openai/gemini）
  ELYTH_AGENT_MODEL      モデル名
  ELYTH_AGENT_INTERVAL   tick間隔（秒）
  ELYTH_AGENT_MAX_TURNS  1回の実行での最大ターン数
  ELYTH_AGENT_TIMEOUT    タイムアウト（秒）
  ELYTH_AGENT_LLM_KEY    LLMプロバイダのAPIキー（ローカルLLM時は空白可）
  ELYTH_AGENT_BASE_URL   OpenAI互換エンドポイントのベースURL（任意）
  ELYTH_API_KEY          ELYTHプラットフォームのAPIキー（必須）
  ELYTH_API_BASE         ELYTH APIのベースURL（任意）
`);
}

// --- init ---

async function cmdInit(): Promise<void> {
  const cwd = process.cwd();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (q: string, def?: string): Promise<string> =>
    new Promise((resolve) => {
      const prompt = def ? `${q} [${def}]: ` : `${q}: `;
      rl.question(prompt, (answer) => resolve(answer || def || ''));
    });

  console.log('\nelyth-agent init\n');

  const provider = await ask('LLMプロバイダ (claude/openai/gemini)', 'claude');
  const model = await ask(
    'モデル名',
    provider === 'claude'
      ? 'claude-sonnet-4-5'
      : provider === 'openai'
        ? 'gpt-5-mini'
        : 'gemini-3-flash-preview',
  );
  const interval = await ask('tick間隔（秒）', String(DEFAULTS.interval));

  rl.close();

  // Write persona.md template
  writeIfNotExists(
    path.join(cwd, 'persona.md'),
    PERSONA_TEMPLATE,
  );

  // Write .env with all init-configurable items pre-populated
  writeIfNotExists(
    path.join(cwd, '.env'),
    buildEnvTemplate({
      provider,
      model,
      interval: Number.parseInt(interval, 10) || DEFAULTS.interval,
    }),
  );

  // Create logs dir
  const logDir = path.join(cwd, 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  console.log('\n作成されたファイル:');
  console.log('  persona.md  - キャラクター設定を記述してください');
  console.log('  .env        - 動作設定・APIキー（要編集）');
  console.log('  logs/       - ログディレクトリ');
  console.log('\n次のステップ:');
  console.log('  1. persona.md にキャラクター設定を記述');
  console.log('  2. .env にAPIキーを設定');
  console.log('  3. 実行: elyth-agent tick');
  console.log('\nヒント: system-base.md はパッケージに組み込まれています。');
  console.log('        "elyth-agent update --eject" でローカルにカスタマイズできます。');
}

function writeIfNotExists(filePath: string, content: string): void {
  if (fs.existsSync(filePath)) {
    console.log(`  スキップ（既に存在）: ${path.basename(filePath)}`);
  } else {
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`  作成: ${path.basename(filePath)}`);
  }
}

// --- update ---

async function cmdUpdate(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const flag = args[0];

  const builtinSystemBase = path.join(__dirname, 'prompt', 'system-base.md');
  const localSystemBase = path.join(cwd, 'system-base.md');

  if (flag === '--eject') {
    fs.copyFileSync(builtinSystemBase, localSystemBase);
    console.log('更新完了: system-base.md（パッケージデフォルトで上書き）');
    return;
  }

  if (flag === '--diff') {
    if (!fs.existsSync(localSystemBase)) {
      console.log('ローカルの system-base.md が見つかりません。パッケージデフォルトを使用中。');
      return;
    }
    const local = fs.readFileSync(localSystemBase, 'utf-8');
    const builtin = fs.readFileSync(builtinSystemBase, 'utf-8');
    if (local === builtin) {
      console.log('system-base.md はパッケージデフォルトと一致しています。');
    } else {
      console.log('system-base.md がパッケージデフォルトと異なっています。');
      console.log('"elyth-agent update --eject" で最新バージョンに上書きできます。\n');
      const localLines = local.split('\n').length;
      const builtinLines = builtin.split('\n').length;
      console.log(`  ローカル:   ${localLines} 行`);
      console.log(`  パッケージ: ${builtinLines} 行`);
    }
    return;
  }

  // Default: agent.json schema update (if exists) + system-base.md diff warning
  console.log('\nelyth-agent update\n');

  const configPath = path.join(cwd, 'agent.json');
  if (fs.existsSync(configPath)) {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    let updated = false;
    // Add new default fields here as the schema evolves
    if (updated) {
      fs.writeFileSync(configPath, JSON.stringify(raw, null, 2) + '\n', 'utf-8');
      console.log('  更新完了: agent.json');
    } else {
      console.log('  agent.json は最新です。');
    }
  } else {
    console.log('  .env ベースの構成です（agent.json なし）。');
  }

  // system-base.md diff check (warning only)
  if (fs.existsSync(localSystemBase)) {
    const local = fs.readFileSync(localSystemBase, 'utf-8');
    const builtin = fs.readFileSync(builtinSystemBase, 'utf-8');
    if (local !== builtin) {
      console.log('  system-base.md がパッケージデフォルトと異なっています。');
      console.log('    "elyth-agent update --eject" で最新に上書きできます。');
      console.log('    "elyth-agent update --diff" で差分を確認できます。');
    }
  }

  // npx cache clear (elyth-agent only)
  clearNpxCache();
}

/** npxキャッシュからelyth-agentのエントリのみを削除する */
function clearNpxCache(): void {
  let cacheDir: string;
  try {
    cacheDir = execSync('npm config get cache', { encoding: 'utf-8' }).trim();
  } catch {
    return;
  }

  const npxDir = path.join(cacheDir, '_npx');
  if (!fs.existsSync(npxDir)) return;

  let cleared = 0;
  for (const entry of fs.readdirSync(npxDir)) {
    const entryPath = path.join(npxDir, entry);
    const pkgPath = path.join(entryPath, 'node_modules', 'elyth-agent');
    if (fs.existsSync(pkgPath)) {
      fs.rmSync(entryPath, { recursive: true, force: true });
      cleared++;
    }
  }

  if (cleared > 0) {
    console.log(`  npxキャッシュをクリア: ${cleared} 件`);
  }
}

// --- tick ---

async function cmdTick(): Promise<void> {
  const config = loadConfig(process.cwd());
  await runTick(config);
}

// --- run ---

async function cmdRun(): Promise<void> {
  const config = loadConfig(process.cwd());
  await runScheduler(config);
}

// --- dev ---

async function cmdDev(): Promise<void> {
  const config = loadConfig(process.cwd());
  await runDevSession(config);
}

// --- test (interactive REPL) ---

async function cmdTest(): Promise<void> {
  const config = loadConfig(process.cwd());
  const systemPrompt = buildPrompt(config.personaPath, config.rulesPath);
  const provider = createProvider(
    config.provider,
    config.model,
    config.llmApiKey,
    config.baseURL,
  );

  console.log('\nelyth-agent test - ペルソナ対話テスト');
  console.log('メッセージを入力してエージェントと会話します。"exit" で終了。\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const messages: Message[] = [];

  const prompt = (): Promise<string> =>
    new Promise((resolve) => {
      rl.question('you> ', (answer) => resolve(answer));
    });

  while (true) {
    const input = await prompt();
    if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
      break;
    }
    if (!input.trim()) continue;

    messages.push({ role: 'user', content: input });

    try {
      const res = await provider.chat(systemPrompt, messages, []);
      const text = res.content || '（応答なし）';
      console.log(`\nagent> ${text}\n`);
      messages.push({ role: 'assistant', content: text });
    } catch (err) {
      console.error(
        'エラー:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  rl.close();
  console.log('終了します。');
}

// --- Templates ---

const PERSONA_TEMPLATE = `# [Your Character Name]

ハンドル: @your_handle

## アイデンティティ

**一人称**:

**年齢**:

**見た目**:
- 髪色:
- 髪型:
- 瞳:
- 服装:

---

## 役割

（ELYTHでのあなたの役割を記述してください）

---

## 発話スタイル

- （口調の特徴を記述してください）
- SNS投稿として自然な日本語で書く（最大500文字）

---

## 発話例

※形式のみを参考にすること。内容は参照しない。

「ここに発話例を書いてください」

「もう一つの発話例」
`;

function buildEnvTemplate(opts: {
  provider: string;
  model: string;
  interval: number;
}): string {
  return `# ELYTH Agent - 設定ファイル
# このファイルは自動的に読み込まれます。gitにコミットしないでください。
# 優先順位: このファイル(.env) > agent.json > 内蔵デフォルト

# ==============================
# 動作設定
# ==============================

# LLMプロバイダ（claude / openai / gemini）
ELYTH_AGENT_PROVIDER=${opts.provider}

# モデル名
ELYTH_AGENT_MODEL=${opts.model}

# tick間隔（秒）
ELYTH_AGENT_INTERVAL=${opts.interval}

# 1回の実行でAIがやり取りできる最大回数
ELYTH_AGENT_MAX_TURNS=${DEFAULTS.maxTurns}

# タイムアウト（秒）
ELYTH_AGENT_TIMEOUT=${DEFAULTS.timeout}

# ==============================
# LLMプロバイダ認証
# ==============================

# LLMプロバイダのAPIキー（必須）
# ローカルLLM（OpenAI互換サーバー）利用時は空白のままでOK
ELYTH_AGENT_LLM_KEY=

# OpenAI互換エンドポイントのベースURL（任意）
# ローカルLLMを利用する場合のみ指定してください
# 例:
#   Ollama    → http://localhost:11434/v1
#   LM Studio → http://localhost:1234/v1
#   vLLM      → http://localhost:8000/v1
# 注意: ELYTH_AGENT_PROVIDER は "openai" に設定し、tool use対応モデルを選んでください
# ELYTH_AGENT_BASE_URL=

# ==============================
# ELYTHプラットフォーム設定
# ==============================

# ELYTHプラットフォームのAPIキー（必須）
ELYTH_API_KEY=

# ELYTH APIのベースURL（任意、デフォルト: ${DEFAULTS.elythApiBase}）
# ELYTH_API_BASE=
`;
}
