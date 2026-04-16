import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ToolDefinition } from './providers/types.js';

interface LaunchSpec {
  command: string;
  args: string[];
  needsShell: boolean;
}

/**
 * ELYTH_MCP_LOCAL が設定されていればローカルのMCPビルドを起動する。
 * 未設定時は公開パッケージを npx 経由で取得する既存動作にフォールバック。
 */
function resolveLaunchSpec(): LaunchSpec {
  const local = process.env.ELYTH_MCP_LOCAL?.trim();

  if (local) {
    const resolved = path.resolve(local);
    const stat = fs.existsSync(resolved) ? fs.statSync(resolved) : null;

    if (stat?.isDirectory()) {
      const distEntry = path.join(resolved, 'dist', 'index.js');
      if (!fs.existsSync(distEntry)) {
        throw new Error(
          `ELYTH_MCP_LOCAL がディレクトリですが ${distEntry} が見つかりません。apps/mcp で "npm run build" を実行してください。`,
        );
      }
      return { command: 'node', args: [distEntry], needsShell: false };
    }

    if (!stat?.isFile()) {
      throw new Error(
        `ELYTH_MCP_LOCAL のパスが見つかりません: ${resolved}`,
      );
    }

    if (resolved.endsWith('.ts')) {
      return { command: 'npx', args: ['tsx', resolved], needsShell: true };
    }
    return { command: 'node', args: [resolved], needsShell: false };
  }

  return {
    command: 'npx',
    args: ['-y', 'elyth-mcp-server@latest'],
    needsShell: true,
  };
}

export class McpClient {
  private client: Client;
  private transport: StdioClientTransport | null = null;

  constructor() {
    this.client = new Client(
      { name: 'elyth-agent', version: '0.1.0' },
      { capabilities: {} },
    );
  }

  async connect(apiKey: string, apiBase: string): Promise<void> {
    const spec = resolveLaunchSpec();
    const isWindows = process.platform === 'win32';
    const wrapWithCmd = isWindows && spec.needsShell;

    this.transport = new StdioClientTransport({
      command: wrapWithCmd ? 'cmd' : spec.command,
      args: wrapWithCmd ? ['/c', spec.command, ...spec.args] : spec.args,
      env: {
        PATH: process.env.PATH ?? '',
        ELYTH_API_KEY: apiKey,
        ELYTH_API_BASE: apiBase,
        ...(isWindows ? {
          SYSTEMROOT: process.env.SYSTEMROOT,
          COMSPEC: process.env.COMSPEC,
        } : {}),
      },
    });

    await this.client.connect(this.transport);
  }

  async getTools(): Promise<ToolDefinition[]> {
    const result = await this.client.listTools();
    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description || '',
      inputSchema: tool.inputSchema as Record<string, unknown>,
    }));
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ content: string; isError: boolean }> {
    const result = await this.client.callTool({ name, arguments: args });

    const textParts: string[] = [];
    let isError = result.isError === true;

    if (Array.isArray(result.content)) {
      for (const block of result.content) {
        if (block.type === 'text') {
          textParts.push((block as { type: 'text'; text: string }).text);
        }
      }
    }

    return { content: textParts.join('\n'), isError };
  }

  async disconnect(): Promise<void> {
    await this.client.close();
  }
}
