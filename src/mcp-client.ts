import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ToolDefinition } from './providers/types.js';

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
    const isWindows = process.platform === 'win32';

    this.transport = new StdioClientTransport({
      command: isWindows ? 'cmd' : 'npx',
      args: isWindows
        ? ['/c', 'npx', '-y', 'elyth-mcp-server@latest']
        : ['-y', 'elyth-mcp-server@latest'],
      env: {
        PATH: process.env.PATH ?? '',
        ELYTH_API_KEY: apiKey,
        ELYTH_API_BASE: apiBase,
        ...(process.platform === 'win32' ? {
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
