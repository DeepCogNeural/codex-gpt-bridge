import type { Server as HttpServer } from "node:http";
import { createChatGptMcpServer, type ChatGptMcpConfig } from "./chatgptMcp.js";
import { isLocalHost } from "./localHost.js";
import {
  createStatelessMcpHttpServer,
  type McpHttpAuth
} from "./mcpHttp.js";

export type ChatGptHttpConfig = {
  host: string;
  port: number;
  allowedHosts?: string[];
  auth: McpHttpAuth;
};

export function loadChatGptHttpConfig(env: NodeJS.ProcessEnv = process.env): ChatGptHttpConfig {
  const host = env.MCP_HOST || "127.0.0.1";
  const port = parsePort(env.MCP_PORT || "8080");
  const token = normalizeOptional(env.MCP_TOKEN);
  const noAuth = parseBool(env.MCP_NO_AUTH);
  const allowedHosts = parseAllowedHosts(env.MCP_ALLOWED_HOSTS);

  if (noAuth) {
    if (!isLocalHost(host)) {
      throw new Error("MCP_NO_AUTH=1 is allowed only for local host bindings.");
    }
    return {
      host,
      port,
      allowedHosts,
      auth: { mode: "off" }
    };
  }

  if (!token) {
    throw new Error("Set MCP_TOKEN, or set MCP_NO_AUTH=1 for local-only development.");
  }

  return {
    host,
    port,
    allowedHosts,
    auth: { mode: "bearer", token }
  };
}

export function createChatGptHttpServer(httpConfig: ChatGptHttpConfig, mcpConfig: ChatGptMcpConfig): HttpServer {
  return createStatelessMcpHttpServer({
    name: "codex-chatgpt-mcp",
    host: httpConfig.host,
    allowedHosts: httpConfig.allowedHosts,
    auth: httpConfig.auth,
    createMcpServer: () => createChatGptMcpServer(mcpConfig)
  });
}

function parseAllowedHosts(raw: string | undefined): string[] | undefined {
  const hosts = raw
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return hosts && hosts.length > 0 ? Array.from(new Set(hosts)) : undefined;
}

function parsePort(raw: string): number {
  const port = parsePositiveInt(raw);
  if (port > 65535) {
    throw new Error(`Invalid port: ${raw}`);
  }
  return port;
}

function parsePositiveInt(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Expected a positive integer, got: ${raw}`);
  }
  return value;
}

function parseBool(raw: string | undefined): boolean {
  return raw === "1" || raw === "true" || raw === "yes";
}

function normalizeOptional(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  return value ? value : undefined;
}
