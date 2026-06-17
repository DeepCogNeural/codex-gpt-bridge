import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createBridgeMcpServer } from "../src/server.js";
import type { CodexUpstream, ToolResult } from "../src/upstream.js";

class FakeUpstream implements CodexUpstream {
  public calls: Array<{ name: string; args: Record<string, unknown> }> = [];

  async listTools(): Promise<unknown> {
    return {
      tools: [{ name: "codex" }, { name: "codex-reply" }]
    };
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    this.calls.push({ name, args });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ threadId: "thread-1", name, args })
        }
      ]
    };
  }

  async close(): Promise<void> {}
}

describe("bridge tools", () => {
  it("advertises read-only annotations when write modes are disabled", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "bridge-root-"));
    const upstream = new FakeUpstream();
    const config = loadConfig({
      CODEX_GPT_BRIDGE_NO_AUTH: "1",
      CODEX_GPT_BRIDGE_ROOTS: root
    });
    const { client, close } = await connectTestClient(config, upstream);

    const tools = await client.listTools();
    const byName = new Map(tools.tools.map((tool) => [tool.name, tool]));

    expect(byName.get("bridge_status")?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    });
    expect(byName.get("codex_run")?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    });
    expect(byName.get("codex_reply")?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    });

    await close();
  });

  it("does not advertise Codex execution tools as read-only when write mode is enabled", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "bridge-root-"));
    const upstream = new FakeUpstream();
    const config = loadConfig({
      CODEX_GPT_BRIDGE_NO_AUTH: "1",
      CODEX_GPT_BRIDGE_ROOTS: root,
      CODEX_GPT_BRIDGE_ALLOW_WRITE: "1",
      CODEX_GPT_BRIDGE_DEFAULT_SANDBOX: "workspace-write"
    });
    const { client, close } = await connectTestClient(config, upstream);

    const tools = await client.listTools();
    const codexRun = tools.tools.find((tool) => tool.name === "codex_run");

    expect(codexRun?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false
    });

    await close();
  });

  it("sanitizes codex_run before forwarding to upstream", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "bridge-root-"));
    const upstream = new FakeUpstream();
    const config = loadConfig({
      CODEX_GPT_BRIDGE_NO_AUTH: "1",
      CODEX_GPT_BRIDGE_ROOTS: root
    });
    const { client, close } = await connectTestClient(config, upstream);

    const result = await client.callTool({
      name: "codex_run",
      arguments: {
        prompt: "summarize this repo",
        cwd: realpathSync(root)
      }
    });

    expect((result.content as Array<{ type: string }>)[0]?.type).toBe("text");
    expect(upstream.calls).toHaveLength(1);
    expect(upstream.calls[0]).toMatchObject({
      name: "codex",
        args: {
          prompt: "summarize this repo",
          cwd: realpathSync(root),
          sandbox: "read-only",
        "approval-policy": "never"
      }
    });

    await close();
  });

  it("blocks codex_run outside allowed roots", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "bridge-root-"));
    const other = mkdtempSync(path.join(tmpdir(), "bridge-other-"));
    const upstream = new FakeUpstream();
    const config = loadConfig({
      CODEX_GPT_BRIDGE_NO_AUTH: "1",
      CODEX_GPT_BRIDGE_ROOTS: root
    });
    const { client, close } = await connectTestClient(config, upstream);

    const result = await client.callTool({
      name: "codex_run",
      arguments: {
        prompt: "summarize this repo",
        cwd: other
      }
    });

    expect(result.isError).toBe(true);
    expect(upstream.calls).toHaveLength(0);

    await close();
  });

  it("blocks codex_run when sensitive-looking files are present", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "bridge-root-"));
    const upstream = new FakeUpstream();
    const config = loadConfig({
      CODEX_GPT_BRIDGE_NO_AUTH: "1",
      CODEX_GPT_BRIDGE_ROOTS: root
    });
    writeFileSync(path.join(root, ".env"), "TOKEN=secret\n");
    const { client, close } = await connectTestClient(config, upstream);

    const result = await client.callTool({
      name: "codex_run",
      arguments: {
        prompt: "summarize this repo",
        cwd: root
      }
    });

    expect(result.isError).toBe(true);
    expect(upstream.calls).toHaveLength(0);

    await close();
  });

  it("can explicitly disable the sensitive file preflight", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "bridge-root-"));
    const upstream = new FakeUpstream();
    const config = loadConfig({
      CODEX_GPT_BRIDGE_NO_AUTH: "1",
      CODEX_GPT_BRIDGE_ROOTS: root,
      CODEX_GPT_BRIDGE_DISABLE_SECRET_SCAN: "1"
    });
    writeFileSync(path.join(root, ".env"), "TOKEN=secret\n");
    const { client, close } = await connectTestClient(config, upstream);

    await client.callTool({
      name: "codex_run",
      arguments: {
        prompt: "summarize this repo",
        cwd: root
      }
    });

    expect(upstream.calls).toHaveLength(1);

    await close();
  });

  it("forwards codex_reply only for a tracked thread", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "bridge-root-"));
    const upstream = new FakeUpstream();
    const config = loadConfig({
      CODEX_GPT_BRIDGE_NO_AUTH: "1",
      CODEX_GPT_BRIDGE_ROOTS: root
    });
    const { client, close } = await connectTestClient(config, upstream);

    await client.callTool({
      name: "codex_run",
      arguments: {
        prompt: "summarize this repo",
        cwd: root
      }
    });

    await client.callTool({
      name: "codex_reply",
      arguments: {
        threadId: "thread-1",
        prompt: "continue"
      }
    });

    expect(upstream.calls[1]).toEqual({
      name: "codex-reply",
      args: {
        threadId: "thread-1",
        prompt: "continue"
      }
    });

    await close();
  });

  it("blocks codex_reply for an unknown thread id", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "bridge-root-"));
    const upstream = new FakeUpstream();
    const config = loadConfig({
      CODEX_GPT_BRIDGE_NO_AUTH: "1",
      CODEX_GPT_BRIDGE_ROOTS: root
    });
    const { client, close } = await connectTestClient(config, upstream);

    const result = await client.callTool({
      name: "codex_reply",
      arguments: {
        threadId: "thread-1",
        prompt: "continue"
      }
    });

    expect(result.isError).toBe(true);
    expect(upstream.calls).toHaveLength(0);

    await close();
  });

  it("reruns the sensitive file preflight before codex_reply", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "bridge-root-"));
    const upstream = new FakeUpstream();
    const config = loadConfig({
      CODEX_GPT_BRIDGE_NO_AUTH: "1",
      CODEX_GPT_BRIDGE_ROOTS: root
    });
    const { client, close } = await connectTestClient(config, upstream);

    await client.callTool({
      name: "codex_run",
      arguments: {
        prompt: "summarize this repo",
        cwd: root
      }
    });
    writeFileSync(path.join(root, ".env"), "TOKEN=secret\n");

    const result = await client.callTool({
      name: "codex_reply",
      arguments: {
        threadId: "thread-1",
        prompt: "continue"
      }
    });

    expect(result.isError).toBe(true);
    expect(upstream.calls).toHaveLength(1);

    await close();
  });
});

async function connectTestClient(config: ReturnType<typeof loadConfig>, upstream: CodexUpstream) {
  const server = createBridgeMcpServer(config, upstream);
  const client = new Client({
    name: "test-client",
    version: "0.0.0"
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    }
  };
}
