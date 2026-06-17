import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeConfig, SandboxMode } from "./config.js";
import { enforceSandbox, findSensitiveFiles, requireAllowedCwd } from "./config.js";
import type { CodexUpstream, ToolResult } from "./upstream.js";
import { extractThreadId, SessionRegistry } from "./sessionRegistry.js";

const sandboxSchema = z.enum(["read-only", "workspace-write", "danger-full-access"]);

export function registerBridgeTools(
  server: McpServer,
  config: BridgeConfig,
  upstream: CodexUpstream,
  sessions: SessionRegistry
): void {
  server.registerTool(
    "bridge_status",
    {
      title: "Bridge Status",
      description: "Inspect bridge policy, allowed roots, and upstream Codex MCP availability.",
      inputSchema: {}
    },
    async () => {
      const tools = await upstream.listTools();
      return textResult({
        bridge: "codex-gpt-bridge",
        auth: config.token && !config.noAuth ? "bearer-token" : "none",
        allowedRoots: config.allowedRoots,
        defaultSandbox: config.defaultSandbox,
        allowWorkspaceWrite: config.allowWorkspaceWrite,
        allowDangerFullAccess: config.allowDangerFullAccess,
        defaultApprovalPolicy: config.defaultApprovalPolicy,
        trackedSessions: sessions.size(),
        upstreamTools: tools
      });
    }
  );

  server.registerTool(
    "codex_run",
    {
      title: "Run Codex",
      description:
        "Start a local Codex session in an allowed working directory. Defaults to read-only sandbox.",
      inputSchema: {
        prompt: z.string().min(1).describe("Task prompt for Codex."),
        cwd: z.string().min(1).describe("Absolute working directory inside the configured allowed roots."),
        sandbox: sandboxSchema.optional().describe("Codex sandbox mode. Defaults to bridge policy."),
        timeoutMs: z
          .number()
          .int()
          .positive()
          .max(30 * 60 * 1000)
          .optional()
          .describe("Request timeout in milliseconds.")
      }
    },
    async (args) => {
      const cwd = requireAllowedCwd(args.cwd, config.allowedRoots);
      if (config.secretScan) {
        const sensitiveFiles = findSensitiveFiles(cwd);
        if (sensitiveFiles.length > 0) {
          throw new Error(
            `Refusing to run Codex because sensitive-looking files were found: ${sensitiveFiles.join(", ")}. Move them outside the allowed root or set CODEX_GPT_BRIDGE_DISABLE_SECRET_SCAN=1 if you accept the risk.`
          );
        }
      }
      const sandbox = enforceSandbox(config, args.sandbox as SandboxMode | undefined);
      const payload: Record<string, unknown> = {
        prompt: args.prompt,
        cwd,
        sandbox,
        "approval-policy": config.defaultApprovalPolicy
      };
      const result = await upstream.callTool("codex", payload, args.timeoutMs || config.upstreamTimeoutMs);
      const threadId = extractThreadId(result);
      if (threadId) {
        sessions.record({
          threadId,
          cwd,
          sandbox,
          createdAt: Date.now()
        });
      }
      return forwardResult(result);
    }
  );

  server.registerTool(
    "codex_reply",
    {
      title: "Reply To Codex",
      description: "Continue a Codex MCP session returned by codex_run.",
      inputSchema: {
        threadId: z.string().min(1).describe("Thread id returned by codex_run."),
        prompt: z.string().min(1).describe("Follow-up prompt for the same Codex session."),
        timeoutMs: z
          .number()
          .int()
          .positive()
          .max(30 * 60 * 1000)
          .optional()
          .describe("Request timeout in milliseconds.")
      }
    },
    async (args) => {
      const session = sessions.get(args.threadId);
      if (!session) {
        throw new Error("Unknown Codex thread id. Start the session through codex_run on this bridge first.");
      }
      if (config.secretScan) {
        const sensitiveFiles = findSensitiveFiles(session.cwd);
        if (sensitiveFiles.length > 0) {
          throw new Error(
            `Refusing to continue Codex because sensitive-looking files were found: ${sensitiveFiles.join(", ")}. Move them outside the allowed root or set CODEX_GPT_BRIDGE_DISABLE_SECRET_SCAN=1 if you accept the risk.`
          );
        }
      }
      return forwardResult(
        await upstream.callTool(
          "codex-reply",
          {
            threadId: args.threadId,
            prompt: args.prompt
          },
          args.timeoutMs || config.upstreamTimeoutMs
        )
      );
    }
  );
}

function forwardResult(result: ToolResult): ToolResult {
  if (Array.isArray(result.content)) {
    return result;
  }
  return textResult(result);
}

function textResult(value: unknown): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}
