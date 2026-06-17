import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHttpServer } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import type { CodexUpstream, ToolResult } from "../src/upstream.js";

class FakeUpstream implements CodexUpstream {
  async listTools(): Promise<unknown> {
    return { tools: [] };
  }

  async callTool(): Promise<ToolResult> {
    return { content: [{ type: "text", text: "ok" }] };
  }

  async close(): Promise<void> {}
}

class DeferredUpstream extends FakeUpstream {
  private pending: Array<(result: ToolResult) => void> = [];

  override async callTool(): Promise<ToolResult> {
    return new Promise<ToolResult>((resolve) => {
      this.pending.push(resolve);
    });
  }

  resolveNext(): void {
    const resolve = this.pending.shift();
    if (!resolve) {
      throw new Error("No pending upstream call.");
    }
    resolve({
      content: [
        {
          type: "text",
          text: JSON.stringify({ threadId: "thread-1", content: "done" })
        }
      ]
    });
  }
}

const servers: Array<{ close: () => void }> = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.close();
  }
});

describe("http server", () => {
  it("serves health without auth", async () => {
    const baseUrl = await start({
      CODEX_GPT_BRIDGE_NO_AUTH: "1"
    });

    const response = await fetch(`${baseUrl}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
  });

  it("returns JSON for OAuth metadata probes in no-auth tunnel mode", async () => {
    const baseUrl = await start({
      CODEX_GPT_BRIDGE_NO_AUTH: "1"
    });

    const response = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/mcp`);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toMatchObject({ error: "oauth_metadata_not_configured" });
  });

  it("requires bearer token on /mcp when configured", async () => {
    const baseUrl = await start({
      CODEX_GPT_BRIDGE_TOKEN: "secret"
    });

    const denied = await fetch(`${baseUrl}/mcp`, { method: "POST", body: "{}" });
    expect(denied.status).toBe(401);

    const allowed = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        authorization: "Bearer secret",
        "content-type": "application/json"
      },
      body: "{}"
    });
    expect(allowed.status).not.toBe(401);
  });

  it("keeps async Codex jobs across stateless HTTP MCP requests", async () => {
    const upstream = new DeferredUpstream();
    const baseUrl = await start(
      {
        CODEX_GPT_BRIDGE_NO_AUTH: "1",
        CODEX_GPT_BRIDGE_FAST_RETURN_MS: "5"
      },
      upstream
    );
    const client = new Client({
      name: "http-test-client",
      version: "0.0.0"
    });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));

    const started = parseToolJson(
      await client.callTool({
        name: "codex_run",
        arguments: {
          prompt: "slow"
        }
      })
    );
    expect(started.status).toBe("running");
    expect(typeof started.jobId).toBe("string");

    upstream.resolveNext();
    const completed = await waitForJobStatus(client, started.jobId, "completed");
    expect(completed.status).toBe("completed");
    expect(JSON.stringify(completed.result)).toContain("thread-1");

    await client.close();
  });
});

async function start(env: NodeJS.ProcessEnv, upstream: CodexUpstream = new FakeUpstream()): Promise<string> {
  const config = loadConfig({
    ...env,
    CODEX_GPT_BRIDGE_HOST: "127.0.0.1",
    CODEX_GPT_BRIDGE_PORT: "1"
  });
  const server = createHttpServer(config, upstream);
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }
  return `http://127.0.0.1:${address.port}`;
}

function parseToolJson(result: unknown): Record<string, any> {
  const content = (result as { content?: Array<{ text?: string }> }).content;
  return JSON.parse(content?.[0]?.text || "{}");
}

async function waitForJobStatus(client: Client, jobId: string, expected: string): Promise<Record<string, any>> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const status = parseToolJson(
      await client.callTool({
        name: "codex_job_status",
        arguments: {
          jobId
        }
      })
    );
    if (status.status === expected) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for job status ${expected}.`);
}
