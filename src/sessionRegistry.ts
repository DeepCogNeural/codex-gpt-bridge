import type { SandboxMode } from "./config.js";
import type { ToolResult } from "./upstream.js";

export type TrackedCodexSession = {
  threadId: string;
  cwd: string;
  sandbox: SandboxMode;
  createdAt: number;
};

export class SessionRegistry {
  private readonly sessions = new Map<string, TrackedCodexSession>();

  constructor(
    private readonly ttlMs = 6 * 60 * 60 * 1000,
    private readonly maxSessions = 1000
  ) {}

  record(session: TrackedCodexSession): void {
    this.prune(Date.now());
    this.sessions.set(session.threadId, session);
    while (this.sessions.size > this.maxSessions) {
      const oldest = this.sessions.keys().next().value;
      if (!oldest) {
        break;
      }
      this.sessions.delete(oldest);
    }
  }

  get(threadId: string): TrackedCodexSession | undefined {
    this.prune(Date.now());
    return this.sessions.get(threadId);
  }

  size(): number {
    this.prune(Date.now());
    return this.sessions.size;
  }

  private prune(now: number): void {
    for (const [threadId, session] of this.sessions) {
      if (now - session.createdAt > this.ttlMs) {
        this.sessions.delete(threadId);
      }
    }
  }
}

export function extractThreadId(result: ToolResult): string | undefined {
  const structured = readThreadId((result as { structuredContent?: unknown }).structuredContent);
  if (structured) {
    return structured;
  }

  for (const item of Array.isArray(result.content) ? result.content : []) {
    if (isRecord(item) && item.type === "text" && typeof item.text === "string") {
      const parsed = parseJson(item.text);
      const fromJson = readThreadId(parsed);
      if (fromJson) {
        return fromJson;
      }
    }
  }

  return undefined;
}

function readThreadId(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return typeof value.threadId === "string" ? value.threadId : undefined;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
