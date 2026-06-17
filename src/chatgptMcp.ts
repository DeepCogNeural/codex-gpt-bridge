import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

export type ChatGptMcpConfig = {
  apiKey?: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  fetchImpl: typeof fetch;
};

type ResponsesApiOutput = {
  id?: string;
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  error?: {
    message?: string;
  };
};

const reasoningEffortSchema = z.enum(["none", "low", "medium", "high", "xhigh"]);

export function loadChatGptMcpConfig(env: NodeJS.ProcessEnv = process.env): ChatGptMcpConfig {
  return {
    apiKey: normalizeOptional(env.OPENAI_API_KEY),
    baseUrl: normalizeBaseUrl(env.OPENAI_BASE_URL || "https://api.openai.com/v1"),
    model: normalizeOptional(env.CODEX_CHATGPT_MODEL) || "gpt-5.5",
    timeoutMs: parsePositiveInt(env.CODEX_CHATGPT_TIMEOUT_MS || "180000"),
    fetchImpl: fetch
  };
}

export function createChatGptMcpServer(config: ChatGptMcpConfig): McpServer {
  const server = new McpServer(
    {
      name: "codex-chatgpt-mcp",
      title: "Codex ChatGPT MCP",
      version: "0.1.0"
    },
    {
      instructions:
        "Use ask_chatgpt for explicit planning, research, or review prompts the user wants sent to an OpenAI API model. Do not send secrets or local file contents unless the user explicitly asks."
    }
  );

  server.registerTool(
    "ask_chatgpt",
    {
      title: "Ask ChatGPT",
      description:
        "Ask an OpenAI API model a prompt and return the text response. This is not the ChatGPT web UI; it uses the official Responses API.",
      inputSchema: {
        prompt: z.string().min(1).describe("The prompt to send."),
        instructions: z
          .string()
          .min(1)
          .optional()
          .describe("Optional system/developer-style instructions for the model."),
        model: z
          .string()
          .min(1)
          .optional()
          .describe("Optional model override. Defaults to CODEX_CHATGPT_MODEL or gpt-5.5."),
        reasoningEffort: reasoningEffortSchema
          .optional()
          .describe("Optional reasoning effort for models that support it."),
        maxOutputTokens: z
          .number()
          .int()
          .positive()
          .max(100000)
          .optional()
          .describe("Optional output token cap."),
        timeoutMs: z
          .number()
          .int()
          .positive()
          .max(30 * 60 * 1000)
          .optional()
          .describe("Optional request timeout in milliseconds.")
      }
    },
    async (args) => {
      const result = await callResponsesApi(config, {
        prompt: args.prompt,
        instructions: args.instructions,
        model: args.model || config.model,
        reasoningEffort: args.reasoningEffort,
        maxOutputTokens: args.maxOutputTokens,
        timeoutMs: args.timeoutMs || config.timeoutMs
      });

      return {
        structuredContent: {
          responseId: result.responseId,
          model: result.model,
          outputText: result.outputText
        },
        content: [
          {
            type: "text",
            text: result.outputText
          }
        ]
      };
    }
  );

  return server;
}

async function callResponsesApi(
  config: ChatGptMcpConfig,
  args: {
    prompt: string;
    instructions?: string;
    model: string;
    reasoningEffort?: z.infer<typeof reasoningEffortSchema>;
    maxOutputTokens?: number;
    timeoutMs: number;
  }
): Promise<{ responseId?: string; model: string; outputText: string }> {
  if (!config.apiKey) {
    throw new Error("OPENAI_API_KEY is not set. Set it before using ask_chatgpt.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs);
  try {
    const body: Record<string, unknown> = {
      model: args.model,
      input: args.prompt
    };
    if (args.instructions) {
      body.instructions = args.instructions;
    }
    if (args.reasoningEffort) {
      body.reasoning = { effort: args.reasoningEffort };
    }
    if (args.maxOutputTokens) {
      body.max_output_tokens = args.maxOutputTokens;
    }

    const response = await config.fetchImpl(`${config.baseUrl}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const payload = (await response.json().catch(() => ({}))) as ResponsesApiOutput;
    if (!response.ok) {
      throw new Error(payload.error?.message || `OpenAI Responses API returned HTTP ${response.status}`);
    }

    const outputText = extractOutputText(payload);
    if (!outputText) {
      throw new Error("OpenAI Responses API returned no text output.");
    }

    return {
      responseId: payload.id,
      model: args.model,
      outputText
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`OpenAI Responses API timed out after ${args.timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function extractOutputText(payload: ResponsesApiOutput): string {
  if (payload.output_text) {
    return payload.output_text;
  }

  const parts: string[] = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) {
        parts.push(content.text);
      }
    }
  }
  return parts.join("\n").trim();
}

function normalizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, "");
}

function normalizeOptional(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  return value ? value : undefined;
}

function parsePositiveInt(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Expected a positive integer, got: ${raw}`);
  }
  return value;
}
