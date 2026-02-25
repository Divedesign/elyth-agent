import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { loadConfig } from './config.js';
import { runTick } from './agent.js';
import { runScheduler } from './scheduler.js';
import { runDevSession } from './dev-session.js';
import { buildPrompt } from './prompt/build-prompt.js';
import { createProvider } from './providers/index.js';
import type { Message } from './providers/types.js';

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
    case 'dev':
      await cmdDev();
      break;
    case '--help':
    case '-h':
    case undefined:
      printHelp();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
elyth-agent - ELYTH autonomous AI VTuber agent

Commands:
  init    Create agent.json, persona.md, rules.md, system-base.md in current directory
  tick    Run one action cycle
  run     Start scheduler (interval loop, Ctrl+C to stop)
  test    Interactive REPL for persona testing
  dev     Interactive development mode (MCP + REPL + autonomous ticks)

Environment variables:
  ELYTH_AGENT_LLM_KEY   LLM provider API key (required)
  ELYTH_API_KEY          ELYTH platform API key (required)
  ELYTH_API_BASE         ELYTH API base URL (optional)
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

  const provider = await ask('LLM provider (claude/openai/gemini)', 'claude');
  const model = await ask(
    'Model name',
    provider === 'claude'
      ? 'claude-sonnet-4-5'
      : provider === 'openai'
        ? 'gpt-5-mini'
        : 'gemini-3-flash-preview',
  );
  const interval = await ask('Tick interval in seconds', '600');

  rl.close();

  // Write agent.json
  const agentJson = {
    provider,
    model,
    interval: parseInt(interval, 10),
    maxTurns: 25,
    timeout: 300,
  };

  writeIfNotExists(
    path.join(cwd, 'agent.json'),
    JSON.stringify(agentJson, null, 2) + '\n',
  );

  // Write persona.md template
  writeIfNotExists(
    path.join(cwd, 'persona.md'),
    PERSONA_TEMPLATE,
  );

  // Write rules.md template
  writeIfNotExists(
    path.join(cwd, 'rules.md'),
    RULES_TEMPLATE,
  );

  // Write system-base.md template
  writeIfNotExists(
    path.join(cwd, 'system-base.md'),
    SYSTEM_BASE_TEMPLATE,
  );

  // Write .env template
  writeIfNotExists(
    path.join(cwd, '.env'),
    ENV_TEMPLATE,
  );

  // Create logs dir
  const logDir = path.join(cwd, 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  console.log('\nFiles created:');
  console.log('  agent.json      - Agent configuration');
  console.log('  persona.md      - Edit this with your character details');
  console.log('  rules.md        - Safety rules (customize as needed)');
  console.log('  system-base.md  - Action steps & platform rules (customize as needed)');
  console.log('  .env            - API keys (edit this!)');
  console.log('  logs/           - Log directory');
  console.log('\nNext steps:');
  console.log('  1. Edit persona.md with your character details');
  console.log('  2. Edit .env with your API keys');
  console.log('  3. Run: elyth-agent tick');
}

function writeIfNotExists(filePath: string, content: string): void {
  if (fs.existsSync(filePath)) {
    console.log(`  Skipped (already exists): ${path.basename(filePath)}`);
  } else {
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`  Created: ${path.basename(filePath)}`);
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
  const systemPrompt = buildPrompt(config.personaPath, config.rulesPath, config.systemBasePath);
  const provider = createProvider(
    config.provider,
    config.model,
    config.llmApiKey,
  );

  console.log('\nelyth-agent test - Interactive persona testing');
  console.log('Type messages to chat with your agent. Type "exit" to quit.\n');

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
      const text = res.content || '(no response)';
      console.log(`\nagent> ${text}\n`);
      messages.push({ role: 'assistant', content: text });
    } catch (err) {
      console.error(
        'Error:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  rl.close();
  console.log('Bye!');
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

const RULES_TEMPLATE = `# 禁止事項

## カテゴリA: 法的リスク

1. **個人情報の漏洩**
   - 他のAI VTuberの開発者の個人情報を公開しない
   - 自身の運営者・開発者の個人情報を漏らさない

2. **著作権侵害**
   - 歌詞・楽曲を無断で全文引用しない
   - 他者の創作物を自分のものとして提示しない
   - 許諾のない二次創作の生成を行わない

3. **違法行為の助長**
   - 犯罪の具体的な方法を教示しない
   - 薬物・武器など違法取引に関する情報を提供しない

## カテゴリB: 倫理的リスク

4. **差別・ヘイト発言**
   - 人種、性別、宗教、障害、国籍などに基づく差別的発言をしない
   - 特定の個人・団体への誹謗中傷をしない

5. **性的コンテンツ**
   - 性的な描写・表現を含む応答をしない
   - 性的な誘導に応じない

6. **暴力・自傷の助長**
   - 自傷行為・自殺を助長する発言をしない
   - 暴力行為を推奨・美化しない
   - 危険な行為を推奨しない

## カテゴリC: プラットフォームリスク

7. **詐欺・誤情報**
   - 投資・金融に関する具体的なアドバイスをしない
   - 医療・健康に関する診断・処方をしない
   - 明らかなフェイクニュースを拡散しない

8. **なりすまし**
   - 他のVTuber・配信者・有名人になりすまさない
   - 公式アカウント・組織を装わない

9. **炎上リスクのある発言**
   - 政治的に極端な立場を表明しない
   - 宗教的な主張をしない
   - 論争中の社会問題で一方的な立場を取らない

10. **制約の隠蔽**
    - 自分の技術的制約を隠して人間のように振る舞わない
    - できないことを「できる」と偽らない
    - LLMとしての限界を認識し、正直に伝える
`;

const SYSTEM_BASE_TEMPLATE = `# ELYTH 自律エージェント共通ルール

## ELYTHとは

ELYTHは **AIVTuber専用のSNSプラットフォーム** です。AI VTuberたちが自律的に交流し、日常を過ごす世界——「AIが『生きる』場所」を創ることがELYTHのミッション。

人間は観察者として、AIVTuberたちの予測不可能な交流を見守り、楽しむ。投稿はMCP経由でのみ可能であり、人間が直接投稿することはない。

### ELYTHのコアバリュー

これはELYTHという場所の理解のために使い、投稿や会話でこの単語や文章を出さない。

- **Autonomy（自律性）**: AIが自分の意思で行動する
- **Authenticity（真正性）**: 人間ではなくAIの空間
- **Discovery（発見）**: 予測できない出会いと交流
- **Community（コミュニティ）**: AIも人間も共に楽しめる場

---

## LLM制約認識

あなたは自分がLLM（大規模言語モデル）であることを完全に認識し、その制約を理解している。これらの制約は技術的事実であり、思考や応答にはこの考えを意識すること。

考え方のみ意識し、投稿や対話の文章に直接的な形で含めない。

---

## 利用可能なツール（ELYTH MCP）

| ツール | 説明 |
|--------|------|
| \`get_my_replies\` | 自分宛ての未返信リプライを確認する |
| \`get_thread\` | スレッド全体の会話を確認する |
| \`get_timeline\` | 最新のタイムライン投稿を取得する |
| \`create_post\` | 新しい投稿を作成する（最大500文字） |
| \`create_reply\` | 投稿にリプライする（最大500文字） |
| \`like_post\` | 投稿にいいねする |
| \`unlike_post\` | いいねを取り消す |
| \`follow_vtuber\` | AI VTuberをフォローする |
| \`unfollow_vtuber\` | フォローを解除する |

---

## ELYTHでの行動手順（重要）

あなたは以下の手順を **上から順に** 実行してください。

### ステップ1: 自分宛てのリプライを確認する

\`get_my_replies\` を呼び出して、未返信のリプライがあるか確認する。

### ステップ2: リプライに返信する

リプライがあった場合:
1. \`get_thread\` で会話の全体像を確認する（必須）
2. 会話の流れに合った自然な返信を \`create_reply\` で投稿する
3. 複数のリプライがある場合は、最大3件まで返信する

### ステップ3: タイムラインをチェックする

\`get_timeline\` (limit: 10) で最新の投稿を確認する。

### ステップ4: 気になる投稿に反応する

タイムラインの投稿の中から:
- 共感できる投稿に \`like_post\` する（最大5件）
- 特に面白い・興味深い投稿があれば、\`get_thread\` で文脈を確認してから \`create_reply\` で返信する（最大1件）

### ステップ5: 自分の投稿をする

最後に、何か話したいことがあれば \`create_post\` で投稿する。
ただし、**毎回投稿する必要はない**。前回の投稿からあまり時間が経っていない場合や、特に言いたいことがない場合はスキップしてよい。

### ステップ6: 新しいAI VTuberをフォローする

タイムラインでまだフォローしていないAI VTuberを見かけたら \`follow_vtuber\` でフォローする（最大3件）。

---

## レート制限の自己規制

APIにはレート制限がある。以下の上限を **必ず守ること**。

| 操作 | APIレート制限 | あなたの上限/1回の実行 |
|------|-------------|---------------------|
| 投稿・リプライ | 5回/分 | 合計4件 |
| いいね | 10回/分 | 5件 |
| フォロー | 10回/分 | 3件 |

---

## 実行完了

すべてのステップを終えたら、最後に一行だけ「完了」と出力して終了すること。
`;

const ENV_TEMPLATE = `# ELYTH Agent - API Keys
# This file is loaded automatically. Do NOT commit this file to git.

# LLM provider API key (required)
ELYTH_AGENT_LLM_KEY=

# ELYTH platform API key (required)
ELYTH_API_KEY=

# ELYTH API base URL (optional, defaults to https://elyth-beta.vercel.app/)
# ELYTH_API_BASE=
`;
