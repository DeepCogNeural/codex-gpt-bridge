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

class DeferredUpstream extends FakeUpstream {
  private pending: Array<{ resolve: (result: ToolResult) => void; reject: (error: Error) => void }> = [];

  override async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    this.calls.push({ name, args });
    return new Promise<ToolResult>((resolve, reject) => {
      this.pending.push({ resolve, reject });
    });
  }

  resolveNext(result: ToolResult = fakeCodexResult()): void {
    const pending = this.pending.shift();
    if (!pending) {
      throw new Error("No pending upstream call.");
    }
    pending.resolve(result);
  }

  rejectNext(error = new Error("upstream failed")): void {
    const pending = this.pending.shift();
    if (!pending) {
      throw new Error("No pending upstream call.");
    }
    pending.reject(error);
  }
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
    expect(byName.get("codex_read")?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
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
    expect(byName.get("codex_job_status")?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
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
      destructiveHint: true,
      openWorldHint: false
    });

    await close();
  });

  it("reports default cwd when only one root is configured", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "bridge-root-"));
    const upstream = new FakeUpstream();
    const config = loadConfig({
      CODEX_GPT_BRIDGE_NO_AUTH: "1",
      CODEX_GPT_BRIDGE_ROOTS: root
    });
    const { client, close } = await connectTestClient(config, upstream);

    const result = await client.callTool({
      name: "bridge_status",
      arguments: {}
    });
    const status = JSON.parse((result.content as Array<{ text: string }>)[0]?.text);

    expect(status.defaultCwd).toBe(realpathSync(root));

    await close();
  });

  it("reports null default cwd when multiple roots are configured", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "bridge-root-"));
    const other = mkdtempSync(path.join(tmpdir(), "bridge-other-"));
    const upstream = new FakeUpstream();
    const config = loadConfig({
      CODEX_GPT_BRIDGE_NO_AUTH: "1",
      CODEX_GPT_BRIDGE_ROOTS: `${root},${other}`
    });
    const { client, close } = await connectTestClient(config, upstream);

    const result = await client.callTool({
      name: "bridge_status",
      arguments: {}
    });
    const status = JSON.parse((result.content as Array<{ text: string }>)[0]?.text);

    expect(status.defaultCwd).toBeNull();

    await close();
  });

  it("exposes only read-only sandbox in the default read-only profile", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "bridge-root-"));
    const upstream = new FakeUpstream();
    const config = loadConfig({
      CODEX_GPT_BRIDGE_NO_AUTH: "1",
      CODEX_GPT_BRIDGE_ROOTS: root
    });
    const { client, close } = await connectTestClient(config, upstream);

    const tools = await client.listTools();
    const codexRun = tools.tools.find((tool) => tool.name === "codex_run");
    const inputSchema = codexRun?.inputSchema as
      | { properties?: { sandbox?: { enum?: string[] } } }
      | undefined;

    expect(inputSchema?.properties?.sandbox?.enum).toEqual(["read-only"]);

    await close();
  });

  it("exposes workspace-write only when write mode is enabled", async () => {
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
    const inputSchema = codexRun?.inputSchema as
      | { properties?: { sandbox?: { enum?: string[] } } }
      | undefined;

    expect(inputSchema?.properties?.sandbox?.enum).toEqual(["read-only", "workspace-write"]);

    await close();
  });

  it("rejects danger-full-access even when configured as the bridge default", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "bridge-root-"));
    const upstream = new FakeUpstream();
    const config = loadConfig({
      CODEX_GPT_BRIDGE_NO_AUTH: "1",
      CODEX_GPT_BRIDGE_ROOTS: root,
      CODEX_GPT_BRIDGE_ALLOW_DANGER: "1",
      CODEX_GPT_BRIDGE_DEFAULT_SANDBOX: "danger-full-access"
    });
    const { client, close } = await connectTestClient(config, upstream);

    const result = await client.callTool({
      name: "codex_run",
      arguments: {
        prompt: "summarize this repo"
      }
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("danger-full-access is not exposed");
    expect(upstream.calls).toHaveLength(0);

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

  it("forces codex_read to use the read-only sandbox", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "bridge-root-"));
    const upstream = new FakeUpstream();
    const config = loadConfig({
      CODEX_GPT_BRIDGE_NO_AUTH: "1",
      CODEX_GPT_BRIDGE_ROOTS: root,
      CODEX_GPT_BRIDGE_ALLOW_WRITE: "1",
      CODEX_GPT_BRIDGE_DEFAULT_SANDBOX: "workspace-write"
    });
    const { client, close } = await connectTestClient(config, upstream);

    await client.callTool({
      name: "codex_read",
      arguments: {
        prompt: "summarize this repo",
        cwd: realpathSync(root)
      }
    });

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

  it("fast-returns slow codex_read jobs with a codex_read operation label", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "bridge-root-"));
    const upstream = new DeferredUpstream();
    const config = loadConfig({
      CODEX_GPT_BRIDGE_NO_AUTH: "1",
      CODEX_GPT_BRIDGE_ROOTS: root,
      CODEX_GPT_BRIDGE_FAST_RETURN_MS: "5"
    });
    const { client, close } = await connectTestClient(config, upstream);

    const started = parseToolJson(
      await client.callTool({
        name: "codex_read",
        arguments: {
          prompt: "slow read-only repo inspection"
        }
      })
    );

    expect(started).toMatchObject({
      status: "running",
      operation: "codex_read"
    });

    upstream.resolveNext();
    const completed = await waitForCompletedJob(client, started.jobId);
    expect(completed).toMatchObject({
      status: "completed",
      operation: "codex_read"
    });

    await close();
  });

  it("fast-returns slow codex_run jobs and later reports completion", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "bridge-root-"));
    const upstream = new DeferredUpstream();
    const config = loadConfig({
      CODEX_GPT_BRIDGE_NO_AUTH: "1",
      CODEX_GPT_BRIDGE_ROOTS: root,
      CODEX_GPT_BRIDGE_FAST_RETURN_MS: "5"
    });
    const { client, close } = await connectTestClient(config, upstream);

    const started = await client.callTool({
      name: "codex_run",
      arguments: {
        prompt: "slow repo inspection"
      }
    });
    const running = parseToolJson(started);

    expect(running).toMatchObject({
      status: "running",
      operation: "codex_run"
    });
    expect(typeof running.jobId).toBe("string");
    expect(upstream.calls).toHaveLength(1);

    const stillRunning = parseToolJson(
      await client.callTool({
        name: "codex_job_status",
        arguments: {
          jobId: running.jobId
        }
      })
    );
    expect(stillRunning.status).toBe("running");

    upstream.resolveNext();
    const completed = await waitForCompletedJob(client, running.jobId);
    expect(completed).toMatchObject({
      status: "completed",
      operation: "codex_run"
    });
    expect(JSON.stringify(completed.result)).toContain("thread-1");

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

  it("reports failed slow codex_run jobs", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "bridge-root-"));
    const upstream = new DeferredUpstream();
    const config = loadConfig({
      CODEX_GPT_BRIDGE_NO_AUTH: "1",
      CODEX_GPT_BRIDGE_ROOTS: root,
      CODEX_GPT_BRIDGE_FAST_RETURN_MS: "5"
    });
    const { client, close } = await connectTestClient(config, upstream);

    const started = parseToolJson(
      await client.callTool({
        name: "codex_run",
        arguments: {
          prompt: "slow failing inspection"
        }
      })
    );
    upstream.rejectNext(new Error("simulated upstream failure"));

    const failed = await waitForFailedJob(client, started.jobId);
    expect(failed).toMatchObject({
      status: "failed",
      operation: "codex_run",
      error: "simulated upstream failure"
    });

    await close();
  });

  it("rejects unknown codex job ids", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "bridge-root-"));
    const upstream = new FakeUpstream();
    const config = loadConfig({
      CODEX_GPT_BRIDGE_NO_AUTH: "1",
      CODEX_GPT_BRIDGE_ROOTS: root
    });
    const { client, close } = await connectTestClient(config, upstream);

    const result = await client.callTool({
      name: "codex_job_status",
      arguments: {
        jobId: "missing-job"
      }
    });

    expect(result.isError).toBe(true);

    await close();
  });

  it("defaults codex_run cwd to the only allowed root", async () => {
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
        prompt: "summarize this repo"
      }
    });

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

  it("requires codex_run cwd when multiple roots are configured", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "bridge-root-"));
    const other = mkdtempSync(path.join(tmpdir(), "bridge-other-"));
    const upstream = new FakeUpstream();
    const config = loadConfig({
      CODEX_GPT_BRIDGE_NO_AUTH: "1",
      CODEX_GPT_BRIDGE_ROOTS: `${root},${other}`
    });
    const { client, close } = await connectTestClient(config, upstream);

    const result = await client.callTool({
      name: "codex_run",
      arguments: {
        prompt: "summarize this repo"
      }
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("cwd is required");
    expect(upstream.calls).toHaveLength(0);

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

function fakeCodexResult(): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ threadId: "thread-1", content: "done" })
      }
    ]
  };
}

function parseToolJson(result: unknown): Record<string, any> {
  const content = (result as { content?: Array<{ text?: string }> }).content;
  return JSON.parse(content?.[0]?.text || "{}");
}

async function waitForCompletedJob(client: Client, jobId: string): Promise<Record<string, any>> {
  return waitForJobStatus(client, jobId, "completed");
}

async function waitForFailedJob(client: Client, jobId: string): Promise<Record<string, any>> {
  return waitForJobStatus(client, jobId, "failed");
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
