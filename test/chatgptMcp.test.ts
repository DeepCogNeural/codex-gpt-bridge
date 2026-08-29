import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import {
  createChatGptMcpServer,
  loadChatGptMcpConfig,
  type ChatGptMcpConfig,
  type StreamDelta
} from "../src/chatgptMcp.js";

describe("codex chatgpt mcp", () => {
  it("parses Responses API env", () => {
    const config = loadChatGptMcpConfig({
      OPENAI_API_KEY: "k",
      OPENAI_BASE_URL: "https://compat.example/v1/",
      CODEX_CHATGPT_MODEL: "gpt-5.6-sol",
      CODEX_CHATGPT_TIMEOUT_MS: "90000"
    });

    expect(config.apiKey).toBe("k");
    expect(config.baseUrl).toBe("https://compat.example/v1");
    expect(config.model).toBe("gpt-5.6-sol");
    expect(config.timeoutMs).toBe(90000);
  });

  it("registers ask_chatgpt", async () => {
    const { client, close } = await connectTestClient({
      ...loadChatGptMcpConfig({
        CODEX_CHATGPT_MODEL: "gpt-5.5"
      }),
      fetchImpl: async () => {
        throw new Error("fetch should not be called");
      }
    });

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(["ask_chatgpt"]);
    await close();
  });

  it("requires an API key before calling OpenAI", async () => {
    let fetchCalled = false;
    const { client, close } = await connectTestClient({
      ...loadChatGptMcpConfig({
        CODEX_CHATGPT_MODEL: "gpt-5.5"
      }),
      fetchImpl: async () => {
        fetchCalled = true;
        throw new Error("fetch should not be called");
      }
    });

    const result = await client.callTool({
      name: "ask_chatgpt",
      arguments: {
        prompt: "Say OK."
      }
    });

    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0]?.text).toContain("OPENAI_API_KEY is not set");
    expect(fetchCalled).toBe(false);
    await close();
  });

  it("calls the Responses API and returns text", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown>; authorization: string | null }> = [];
    const config: ChatGptMcpConfig = {
      apiKey: "test-key",
      baseUrl: "https://api.test/v1",
      model: "gpt-5.5",
      timeoutMs: 1000,
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          body: JSON.parse(String(init?.body)),
          authorization: new Headers(init?.headers).get("authorization")
        });
        return sseResponse([
          {
            event: "response.output_text.delta",
            data: { delta: "OK" }
          },
          {
            event: "response.completed",
            data: { response: { id: "resp_123", output_text: "OK" } }
          }
        ]);
      }
    };
    const { client, close } = await connectTestClient(config);

    const result = await client.callTool({
      name: "ask_chatgpt",
      arguments: {
        prompt: "Say OK.",
        instructions: "Be terse.",
        reasoningEffort: "xhigh",
        maxOutputTokens: 32
      }
    });

    expect((result.content as Array<{ text: string }>)[0]?.text).toBe("OK");
    expect(result.structuredContent).toMatchObject({
      responseId: "resp_123",
      model: "gpt-5.5",
      outputText: "OK"
    });
    expect(requests).toEqual([
      {
        url: "https://api.test/v1/responses",
        authorization: "Bearer test-key",
        body: {
          model: "gpt-5.5",
          input: "Say OK.",
          stream: true,
          instructions: "Be terse.",
          reasoning: { effort: "xhigh", summary: "auto" },
          max_output_tokens: 32
        }
      }
    ]);

    await close();
  });

  it("streams reasoning and output deltas as MCP progress notifications", async () => {
    const config: ChatGptMcpConfig = {
      apiKey: "test-key",
      baseUrl: "https://api.test/v1",
      model: "gpt-5.5",
      timeoutMs: 1000,
      fetchImpl: async () =>
        sseResponse([
          {
            event: "response.reasoning_summary_text.delta",
            data: { delta: "thinking" }
          },
          {
            event: "response.output_text.delta",
            data: { delta: "Hello" }
          },
          {
            event: "response.completed",
            data: { response: { id: "resp_stream", output_text: "Hello world" } }
          }
        ])
    };
    const { client, close } = await connectTestClient(config);
    const progressDeltas: StreamDelta[] = [];

    const result = await client.callTool(
      {
        name: "ask_chatgpt",
        arguments: {
          prompt: "Say hello."
        }
      },
      undefined,
      {
        onprogress: (progress) => {
          if (progress.message) {
            progressDeltas.push(parseStreamDelta(progress.message));
          }
        }
      }
    );

    expect(progressDeltas).toEqual([
      { kind: "reasoning", text: "thinking" },
      { kind: "output", text: "Hello" }
    ]);
    expect((result.content as Array<{ text: string }>)[0]?.text).toBe("Hello world");
    expect(result.structuredContent).toMatchObject({
      responseId: "resp_stream",
      model: "gpt-5.5",
      outputText: "Hello world"
    });

    await close();
  });

  it("ignores output deltas after the completed event", async () => {
    const config: ChatGptMcpConfig = {
      apiKey: "test-key",
      baseUrl: "https://api.test/v1",
      model: "gpt-5.5",
      timeoutMs: 1000,
      fetchImpl: async () =>
        sseResponse([
          {
            event: "response.output_text.delta",
            data: { delta: "Hello" }
          },
          {
            event: "response.completed",
            data: { response: { id: "resp_freeze", output_text: "Hello" } }
          },
          {
            event: "response.output_text.delta",
            data: { delta: " extra" }
          }
        ])
    };
    const { client, close } = await connectTestClient(config);
    const progressDeltas: StreamDelta[] = [];

    const result = await client.callTool(
      {
        name: "ask_chatgpt",
        arguments: {
          prompt: "Say hello."
        }
      },
      undefined,
      {
        onprogress: (progress) => {
          if (progress.message) {
            progressDeltas.push(parseStreamDelta(progress.message));
          }
        }
      }
    );

    expect(progressDeltas).toEqual([{ kind: "output", text: "Hello" }]);
    expect((result.content as Array<{ text: string }>)[0]?.text).toBe("Hello");

    await close();
  });

  it("maps SSE frames that only set data.type", async () => {
    const config: ChatGptMcpConfig = {
      apiKey: "test-key",
      baseUrl: "https://api.test/v1",
      model: "gpt-5.5",
      timeoutMs: 1000,
      fetchImpl: async () =>
        new Response(
          `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "typed" })}\n\ndata: ${JSON.stringify({ type: "response.completed", response: { id: "resp_type", output_text: "typed" } })}\n\n`,
          {
            status: 200,
            headers: { "content-type": "text/event-stream" }
          }
        )
    };
    const { client, close } = await connectTestClient(config);

    const result = await client.callTool({
      name: "ask_chatgpt",
      arguments: {
        prompt: "Say OK."
      }
    });

    expect((result.content as Array<{ text: string }>)[0]?.text).toBe("typed");
    expect(result.structuredContent).toMatchObject({
      responseId: "resp_type",
      outputText: "typed"
    });

    await close();
  });

  it("returns final text without a progress token", async () => {
    const config: ChatGptMcpConfig = {
      apiKey: "test-key",
      baseUrl: "https://api.test/v1",
      model: "gpt-5.5",
      timeoutMs: 1000,
      fetchImpl: async () =>
        sseResponse([
          {
            event: "response.output_text.delta",
            data: { delta: "sol-ok" }
          },
          {
            event: "response.completed",
            data: { response: { id: "resp_no_progress", output_text: "sol-ok" } }
          }
        ])
    };
    const { client, close } = await connectTestClient(config);

    const result = await client.callTool({
      name: "ask_chatgpt",
      arguments: {
        prompt: "Say OK."
      }
    });

    expect((result.content as Array<{ text: string }>)[0]?.text).toBe("sol-ok");
    expect(result.structuredContent).toMatchObject({
      responseId: "resp_no_progress",
      model: "gpt-5.5",
      outputText: "sol-ok"
    });

    await close();
  });

  it("rejects reasoning efforts unsupported by the default GPT-5.5 config", async () => {
    const config: ChatGptMcpConfig = {
      apiKey: "test-key",
      baseUrl: "https://api.test/v1",
      model: "gpt-5.5",
      timeoutMs: 1000,
      fetchImpl: async () => {
        throw new Error("fetch should not be called");
      }
    };
    const { client, close } = await connectTestClient(config);

    const result = await client.callTool({
      name: "ask_chatgpt",
      arguments: {
        prompt: "Say OK.",
        reasoningEffort: "minimal"
      }
    });

    expect(result.isError).toBe(true);

    await close();
  });
});

function parseStreamDelta(message: string): StreamDelta {
  const parsed: unknown = JSON.parse(message);
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "kind" in parsed &&
    "text" in parsed &&
    typeof parsed.text === "string" &&
    (parsed.kind === "reasoning" || parsed.kind === "output")
  ) {
    if (parsed.kind === "reasoning") {
      return { kind: "reasoning", text: parsed.text };
    }
    return { kind: "output", text: parsed.text };
  }
  throw new Error(`Invalid stream delta: ${message}`);
}

function sseResponse(events: Array<{ event: string; data: Record<string, unknown> }>): Response {
  const body = events.map((event) => `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`).join("");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" }
  });
}

async function connectTestClient(config: ChatGptMcpConfig) {
  const server = createChatGptMcpServer(config);
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
