import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

export type ChatGptMcpConfig = {
  apiKey?: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  fetchImpl: typeof fetch;
};

export type StreamDelta =
  | { kind: "reasoning"; text: string }
  | { kind: "output"; text: string };

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
    async (args, extra) => {
      let progressCount = 0;
      const result = await callResponsesApi(
        config,
        {
          prompt: args.prompt,
          instructions: args.instructions,
          model: args.model || config.model,
          reasoningEffort: args.reasoningEffort,
          maxOutputTokens: args.maxOutputTokens,
          timeoutMs: args.timeoutMs || config.timeoutMs,
          signal: extra.signal
        },
        async (delta) => {
          const token = extra._meta?.progressToken;
          if (token === undefined || delta.text.length === 0) {
            return;
          }
          progressCount += 1;
          try {
            await extra.sendNotification({
              method: "notifications/progress",
              params: {
                progressToken: token,
                progress: progressCount,
                message: JSON.stringify(delta)
              }
            });
          } catch {
            // Keep assembling the answer if Cursor drops a progress notification.
          }
        }
      );

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

type ParsedSseEvent =
  | { type: "reasoning_delta"; text: string }
  | { type: "output_delta"; text: string }
  | { type: "completed"; responseId?: string; outputText?: string }
  | { type: "error"; message: string };

async function callResponsesApi(
  config: ChatGptMcpConfig,
  args: {
    prompt: string;
    instructions?: string;
    model: string;
    reasoningEffort?: z.infer<typeof reasoningEffortSchema>;
    maxOutputTokens?: number;
    timeoutMs: number;
    signal?: AbortSignal;
  },
  onDelta: (delta: StreamDelta) => void | Promise<void> = () => undefined
): Promise<{ responseId?: string; model: string; outputText: string }> {
  if (!config.apiKey) {
    throw new Error("OPENAI_API_KEY is not set. Set it before using ask_chatgpt.");
  }

  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), args.timeoutMs);
  const signals = [timeoutController.signal];
  if (args.signal) {
    signals.push(args.signal);
  }
  const signal = AbortSignal.any(signals);

  try {
    const body: Record<string, unknown> = {
      model: args.model,
      input: args.prompt,
      stream: true
    };
    if (args.instructions) {
      body.instructions = args.instructions;
    }
    if (args.reasoningEffort && args.reasoningEffort !== "none") {
      body.reasoning = { effort: args.reasoningEffort, summary: "auto" };
    } else if (args.reasoningEffort === "none") {
      body.reasoning = { effort: "none" };
    }
    if (args.maxOutputTokens) {
      body.max_output_tokens = args.maxOutputTokens;
    }

    const response = await config.fetchImpl(`${config.baseUrl}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
        accept: "text/event-stream"
      },
      body: JSON.stringify(body),
      signal
    });

    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => ({}));
      throw new Error(
        extractApiErrorMessage(payload) || `OpenAI Responses API returned HTTP ${response.status}`
      );
    }

    if (!response.body) {
      throw new Error("OpenAI Responses API returned no body.");
    }

    let outputDeltas = "";
    let completedOutputText = "";
    let responseId: string | undefined;
    let frozen = false;

    for await (const event of parseOpenAiSse(response.body)) {
      if (frozen) {
        continue;
      }

      switch (event.type) {
        case "reasoning_delta":
          await onDelta({ kind: "reasoning", text: event.text });
          break;
        case "output_delta":
          outputDeltas += event.text;
          await onDelta({ kind: "output", text: event.text });
          break;
        case "completed":
          if (event.responseId !== undefined) {
            responseId = event.responseId;
          }
          if (event.outputText) {
            completedOutputText = event.outputText;
          }
          frozen = true;
          break;
        case "error":
          throw new Error(event.message);
        default: {
          const unhandled: never = event;
          throw new Error(`Unhandled SSE event: ${String(unhandled)}`);
        }
      }
    }

    const outputText = completedOutputText.trim() ? completedOutputText : outputDeltas;
    if (!outputText.trim()) {
      throw new Error("OpenAI Responses API returned no text output.");
    }

    return {
      responseId,
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

async function* parseOpenAiSse(body: ReadableStream<Uint8Array>): AsyncGenerator<ParsedSseEvent> {
  const decoder = new TextDecoder();
  let buffer = "";
  const reader = body.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

      let frameEnd = buffer.indexOf("\n\n");
      while (frameEnd !== -1) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);
        const parsed = parseSseFrame(frame);
        if (parsed) {
          const mapped = mapSseEvent(parsed.eventName, parsed.data);
          if (mapped) {
            yield mapped;
          }
        }
        frameEnd = buffer.indexOf("\n\n");
      }
    }

    if (buffer.trim()) {
      const parsed = parseSseFrame(buffer);
      if (parsed) {
        const mapped = mapSseEvent(parsed.eventName, parsed.data);
        if (mapped) {
          yield mapped;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSseFrame(frame: string): { eventName: string; data: unknown } | undefined {
  let eventName = "";
  const dataLines: string[] = [];

  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (dataLines.length === 0) {
    return undefined;
  }

  try {
    return { eventName, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return undefined;
  }
}

function mapSseEvent(eventName: string, data: unknown): ParsedSseEvent | undefined {
  const typeName =
    eventName ||
    (isRecord(data) && typeof data.type === "string" ? data.type : "");

  if (typeName === "error") {
    return { type: "error", message: extractErrorMessage(data) };
  }

  if (typeName === "response.reasoning_summary_text.delta") {
    const text = extractDeltaText(data);
    if (text === undefined) {
      return undefined;
    }
    return { type: "reasoning_delta", text };
  }

  if (typeName === "response.output_text.delta") {
    const text = extractDeltaText(data);
    if (text === undefined) {
      return undefined;
    }
    return { type: "output_delta", text };
  }

  if (typeName === "response.completed") {
    return extractCompleted(data);
  }

  return undefined;
}

function extractDeltaText(data: unknown): string | undefined {
  if (!isRecord(data)) {
    return undefined;
  }
  const delta = data.delta;
  return typeof delta === "string" ? delta : undefined;
}

function extractCompleted(data: unknown): ParsedSseEvent {
  let responseId: string | undefined;
  let outputText: string | undefined;

  if (isRecord(data)) {
    const response = data.response;
    if (isRecord(response)) {
      responseId = getStringField(response, "id");
      outputText = getStringField(response, "output_text");
    }
    if (!responseId) {
      responseId = getStringField(data, "id");
    }
    if (!outputText) {
      outputText = getStringField(data, "output_text");
    }
  }

  return { type: "completed", responseId, outputText };
}

function extractErrorMessage(data: unknown): string {
  if (!isRecord(data)) {
    return "OpenAI Responses API stream error.";
  }
  const message = getStringField(data, "message");
  if (message) {
    return message;
  }
  const error = data.error;
  if (isRecord(error)) {
    const nested = getStringField(error, "message");
    if (nested) {
      return nested;
    }
  }
  return "OpenAI Responses API stream error.";
}

function extractApiErrorMessage(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  const error = payload.error;
  if (!isRecord(error)) {
    return undefined;
  }
  return getStringField(error, "message");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getStringField(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === "string" ? value : undefined;
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
