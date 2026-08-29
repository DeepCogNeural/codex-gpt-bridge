import type { Server as HttpServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeConfig } from "./config.js";
import { createStatelessMcpHttpServer, type McpHttpAuth } from "./mcpHttp.js";
import type { CodexUpstream } from "./upstream.js";
import { CodexJobRegistry, registerBridgeTools } from "./tools.js";
import { SessionRegistry } from "./sessionRegistry.js";

export function createBridgeMcpServer(
  config: BridgeConfig,
  upstream: CodexUpstream,
  sessions = new SessionRegistry(),
  jobs = new CodexJobRegistry()
): McpServer {
  const server = new McpServer(
    {
      name: "codex-gpt-bridge",
      title: "Codex GPT Bridge",
      version: "0.1.0"
    },
    {
      instructions:
        "Use codex_read for read-only project inspection inside allowed roots. Use codex_run only for intentional execution or write-mode tasks. The bridge enforces sandbox and cwd policy. Do not request secrets or broad system access."
    }
  );
  registerBridgeTools(server, config, upstream, sessions, jobs);
  return server;
}

export function createHttpServer(config: BridgeConfig, upstream: CodexUpstream): HttpServer {
  const sessions = new SessionRegistry();
  const jobs = new CodexJobRegistry();
  return createStatelessMcpHttpServer({
    name: "codex-gpt-bridge",
    host: config.host,
    allowedHosts: config.allowedHosts,
    auth: bridgeAuth(config),
    oauthMetadataMessage: "This local bridge runs with No Auth when it is behind OpenAI Secure MCP Tunnel.",
    createMcpServer: () => createBridgeMcpServer(config, upstream, sessions, jobs)
  });
}

function bridgeAuth(config: BridgeConfig): McpHttpAuth {
  if (config.noAuth) {
    return { mode: "off" };
  }
  if (!config.token) {
    throw new Error("Set CODEX_GPT_BRIDGE_TOKEN, or set CODEX_GPT_BRIDGE_NO_AUTH=1 for local-only development.");
  }
  return { mode: "bearer", token: config.token };
}
