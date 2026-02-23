import fs from 'node:fs';
import path from 'node:path';
import type { ToolCall, LLMResponse } from './providers/types.js';

interface LogEntry {
  type: string;
  timestamp: string;
  [key: string]: unknown;
}

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

export class Logger {
  private logFile: string;
  private stream: fs.WriteStream;

  constructor(logDir: string) {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19);
    this.logFile = path.join(logDir, `${timestamp}.jsonl`);
    this.stream = fs.createWriteStream(this.logFile, { flags: 'a' });
  }

  private write(entry: LogEntry): void {
    this.stream.write(JSON.stringify(entry) + '\n');
  }

  private now(): string {
    return new Date().toISOString();
  }

  logTickStart(provider: string, model: string): void {
    this.write({
      type: 'tick_start',
      timestamp: this.now(),
      provider,
      model,
    });
    console.log(
      `${COLORS.cyan}[tick_start]${COLORS.reset} provider=${provider} model=${model}`,
    );
  }

  logToolCall(call: ToolCall): void {
    this.write({
      type: 'tool_call',
      timestamp: this.now(),
      name: call.name,
      input: call.input,
    });
    console.log(
      `${COLORS.yellow}[tool_call]${COLORS.reset} ${call.name}(${JSON.stringify(call.input)})`,
    );
  }

  logToolResult(
    call: ToolCall,
    result: { content: string; isError: boolean },
  ): void {
    this.write({
      type: 'tool_result',
      timestamp: this.now(),
      name: call.name,
      content: result.content,
      isError: result.isError,
    });
    const color = result.isError ? COLORS.red : COLORS.green;
    const preview =
      result.content.length > 200
        ? result.content.slice(0, 200) + '...'
        : result.content;
    console.log(
      `${color}[tool_result]${COLORS.reset} ${call.name} → ${preview}`,
    );
  }

  logResponse(res: LLMResponse): void {
    this.write({
      type: 'llm_response',
      timestamp: this.now(),
      content: res.content,
      stopReason: res.stopReason,
      toolCallCount: res.toolCalls.length,
    });
    if (res.content) {
      console.log(
        `${COLORS.magenta}[llm]${COLORS.reset} ${res.content}`,
      );
    }
    if (res.toolCalls.length > 0) {
      console.log(
        `${COLORS.dim}  (${res.toolCalls.length} tool calls, stopReason=${res.stopReason})${COLORS.reset}`,
      );
    }
  }

  logTickEnd(turns: number, durationMs: number): void {
    this.write({
      type: 'tick_end',
      timestamp: this.now(),
      turns,
      durationMs,
    });
    console.log(
      `${COLORS.cyan}[tick_end]${COLORS.reset} turns=${turns} duration=${(durationMs / 1000).toFixed(1)}s`,
    );
    console.log(
      `${COLORS.dim}  log: ${this.logFile}${COLORS.reset}`,
    );
  }

  logError(error: unknown): void {
    const message =
      error instanceof Error ? error.message : String(error);
    this.write({
      type: 'error',
      timestamp: this.now(),
      message,
    });
    console.error(`${COLORS.red}[error]${COLORS.reset} ${message}`);
  }

  close(): void {
    this.stream.end();
  }

  static cleanOldLogs(logDir: string, maxAgeDays: number = 7): void {
    if (!fs.existsSync(logDir)) return;
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    for (const file of fs.readdirSync(logDir)) {
      const filePath = path.join(logDir, file);
      const stat = fs.statSync(filePath);
      if (stat.isFile() && stat.mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
        console.log(
          `${COLORS.dim}  Deleted old log: ${file}${COLORS.reset}`,
        );
      }
    }
  }
}
