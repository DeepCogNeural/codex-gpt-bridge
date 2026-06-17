import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type ToolResult = CallToolResult;

export type CodexUpstream = {
  listTools(): Promise<unknown>;
  callTool(name: string, args: Record<string, unknown>, timeoutMs: number): Promise<ToolResult>;
  close(): Promise<void>;
};

export class CodexStdioUpstream implements CodexUpstream {
  private client?: Client;
  private transport?: StdioClientTransport;
  private connecting?: Promise<Client>;

  constructor(private readonly codexCommand: string) {}

  async listTools(): Promise<unknown> {
    const client = await this.getClient();
    return client.listTools();
  }

  async callTool(name: string, args: Record<string, unknown>, timeoutMs: number): Promise<ToolResult> {
    const client = await this.getClient();
    return client.callTool(
      {
        name,
        arguments: args
      },
      undefined,
      {
        timeout: timeoutMs,
        resetTimeoutOnProgress: true
      }
    ) as Promise<ToolResult>;
  }

  async close(): Promise<void> {
    await this.client?.close();
    await this.transport?.close();
    this.client = undefined;
    this.transport = undefined;
    this.connecting = undefined;
  }

  private async getClient(): Promise<Client> {
    if (this.client) {
      return this.client;
    }
    if (!this.connecting) {
      this.connecting = this.connect();
    }
    this.client = await this.connecting;
    return this.client;
  }

  private async connect(): Promise<Client> {
    const transport = new StdioClientTransport({
      command: this.codexCommand,
      args: ["mcp-server"],
      stderr: "pipe"
    });
    transport.stderr?.on("data", (chunk) => {
      process.stderr.write(`[codex-mcp] ${chunk.toString()}`);
    });

    const client = new Client(
      {
        name: "codex-gpt-bridge",
        version: "0.1.0"
      },
      {
        capabilities: {}
      }
    );
    await client.connect(transport);
    this.transport = transport;
    return client;
  }
}
