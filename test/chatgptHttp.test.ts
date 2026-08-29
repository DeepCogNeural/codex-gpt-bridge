import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createChatGptHttpServer, loadChatGptHttpConfig } from "../src/chatgptHttp.js";
import { loadChatGptMcpConfig, type ChatGptMcpConfig } from "../src/chatgptMcp.js";

const servers: Array<{ close: () => void }> = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.close();
  }
});

describe("chatgpt http config", () => {
  it("requires a token unless local no-auth is set", () => {
    expect(() => loadChatGptHttpConfig({})).toThrow(/MCP_TOKEN/);
    expect(() =>
      loadChatGptHttpConfig({
        MCP_HOST: "0.0.0.0",
        MCP_NO_AUTH: "1"
      })
    ).toThrow(/MCP_NO_AUTH/);
  });

  it("parses bind, token, and allowed hosts", () => {
    const config = loadChatGptHttpConfig({
      MCP_HOST: "0.0.0.0",
      MCP_PORT: "8080",
      MCP_TOKEN: "secret",
      MCP_ALLOWED_HOSTS: "127.0.0.1,example.local"
    });

    expect(config.host).toBe("0.0.0.0");
    expect(config.port).toBe(8080);
    expect(config.allowedHosts).toEqual(["127.0.0.1", "example.local"]);
    expect(config.auth).toEqual({ mode: "bearer", token: "secret" });
  });

  it("allows no-auth on localhost", () => {
    const config = loadChatGptHttpConfig({
      MCP_HOST: "127.0.0.1",
      MCP_NO_AUTH: "1"
    });
    expect(config.auth).toEqual({ mode: "off" });
  });
});

describe("chatgpt http server", () => {
  it("serves health without auth", async () => {
    const baseUrl = await startHttp({
      MCP_NO_AUTH: "1"
    });

    const response = await fetch(`${baseUrl}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      name: "codex-chatgpt-mcp"
    });
  });

  it("rejects unauthenticated /mcp when a token is set", async () => {
    const baseUrl = await startHttp({
      MCP_TOKEN: "secret"
    });

    const denied = await fetch(`${baseUrl}/mcp`, { method: "POST", body: "{}" });
    expect(denied.status).toBe(401);
  });

  it("accepts authenticated Streamable HTTP MCP and exposes ask_chatgpt", async () => {
    const baseUrl = await startHttp(
      {
        MCP_TOKEN: "secret"
      },
      {
        apiKey: "test-key",
        baseUrl: "https://api.test/v1",
        model: "gpt-5.6-sol",
        timeoutMs: 1000,
        fetchImpl: async () =>
          sseResponse([
            {
              event: "response.output_text.delta",
              data: { delta: "sol-ok" }
            },
            {
              event: "response.completed",
              data: { response: { id: "resp_http", output_text: "sol-ok" } }
            }
          ])
      }
    );

    const client = new Client({
      name: "chatgpt-http-test",
      version: "0.0.0"
    });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
        requestInit: {
          headers: {
            authorization: "Bearer secret"
          }
        }
      })
    );

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain("ask_chatgpt");

    const result = await client.callTool({
      name: "ask_chatgpt",
      arguments: {
        prompt: "Say OK.",
        reasoningEffort: "xhigh"
      }
    });
    expect((result.content as Array<{ text: string }>)[0]?.text).toBe("sol-ok");

    await client.close();
  });
});

function sseResponse(events: Array<{ event: string; data: Record<string, unknown> }>): Response {
  const body = events.map((event) => `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`).join("");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" }
  });
}

async function startHttp(env: NodeJS.ProcessEnv, mcp: Partial<ChatGptMcpConfig> = {}): Promise<string> {
  const httpConfig = loadChatGptHttpConfig({
    MCP_HOST: "127.0.0.1",
    MCP_PORT: "1",
    ...env
  });
  const mcpConfig: ChatGptMcpConfig = {
    ...loadChatGptMcpConfig({
      OPENAI_API_KEY: "test-key",
      CODEX_CHATGPT_MODEL: "gpt-5.6-sol"
    }),
    fetchImpl: async () => {
      throw new Error("fetch should not be called");
    },
    ...mcp
  };
  const server = createChatGptHttpServer(httpConfig, mcpConfig);
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
