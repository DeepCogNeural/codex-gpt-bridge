import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createChatGptMcpServer, loadChatGptMcpConfig, type ChatGptMcpConfig } from "../src/chatgptMcp.js";

describe("codex chatgpt mcp", () => {
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
        return Response.json({
          id: "resp_123",
          output_text: "OK"
        });
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
          instructions: "Be terse.",
          reasoning: { effort: "xhigh" },
          max_output_tokens: 32
        }
      }
    ]);

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
