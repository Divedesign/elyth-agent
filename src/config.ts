import fs from 'node:fs';
import path from 'node:path';

export interface AgentConfig {
  provider: 'claude' | 'openai' | 'gemini';
  model: string;
  interval: number;
  maxTurns: number;
  timeout: number;
  personaPath: string;
  rulesPath: string;
  systemBasePath: string;
  logDir: string;
  llmApiKey: string;
  elythApiKey: string;
  elythApiBase: string;
}

interface AgentJsonRaw {
  provider?: string;
  model?: string;
  interval?: number;
  maxTurns?: number;
  timeout?: number;
  llmApiKey?: string;
  elythApiKey?: string;
  elythApiBase?: string;
}

const DEFAULTS = {
  provider: 'claude' as const,
  model: 'claude-sonnet-4-6',
  interval: 600,
  maxTurns: 25,
  timeout: 300,
  elythApiBase: 'https://elyth-beta.vercel.app/',
};

/** Load .env file into process.env (existing env vars take priority) */
function loadDotEnv(workDir: string): void {
  const envPath = path.join(workDir, '.env');
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Don't overwrite existing env vars
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function loadConfig(workDir: string): AgentConfig {
  loadDotEnv(workDir);
  const configPath = path.join(workDir, 'agent.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `agent.json not found in ${workDir}. Run "elyth-agent init" first.`,
    );
  }

  const raw: AgentJsonRaw = JSON.parse(
    fs.readFileSync(configPath, 'utf-8'),
  );

  const provider = validateProvider(raw.provider ?? DEFAULTS.provider);
  const model = raw.model ?? DEFAULTS.model;
  const interval = raw.interval ?? DEFAULTS.interval;
  const maxTurns = raw.maxTurns ?? DEFAULTS.maxTurns;
  const timeout = raw.timeout ?? DEFAULTS.timeout;

  const personaPath = path.join(workDir, 'persona.md');
  const rulesPath = path.join(workDir, 'rules.md');
  const systemBasePath = path.join(workDir, 'system-base.md');
  const logDir = path.join(workDir, 'logs');

  if (!fs.existsSync(personaPath)) {
    throw new Error(
      `persona.md not found in ${workDir}. Create it or run "elyth-agent init".`,
    );
  }

  if (!fs.existsSync(systemBasePath)) {
    throw new Error(
      `system-base.md not found in ${workDir}. Run "elyth-agent init" to generate it.`,
    );
  }

  // API keys: env vars take priority, then config file
  const llmApiKey =
    process.env.ELYTH_AGENT_LLM_KEY ?? raw.llmApiKey ?? '';
  const elythApiKey =
    process.env.ELYTH_API_KEY ?? raw.elythApiKey ?? '';
  const elythApiBase =
    process.env.ELYTH_API_BASE ??
    raw.elythApiBase ??
    DEFAULTS.elythApiBase;

  if (!llmApiKey) {
    throw new Error(
      'LLM API key not set. Set ELYTH_AGENT_LLM_KEY in .env, environment variable, or "llmApiKey" in agent.json.',
    );
  }
  if (!elythApiKey) {
    throw new Error(
      'ELYTH API key not set. Set ELYTH_API_KEY in .env, environment variable, or "elythApiKey" in agent.json.',
    );
  }

  return {
    provider,
    model,
    interval,
    maxTurns,
    timeout,
    personaPath,
    rulesPath,
    systemBasePath,
    logDir,
    llmApiKey,
    elythApiKey,
    elythApiBase,
  };
}

function validateProvider(
  value: string,
): 'claude' | 'openai' | 'gemini' {
  if (value === 'claude' || value === 'openai' || value === 'gemini') {
    return value;
  }
  throw new Error(
    `Invalid provider "${value}". Must be one of: claude, openai, gemini`,
  );
}
