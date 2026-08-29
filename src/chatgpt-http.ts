#!/usr/bin/env node
import { createChatGptHttpServer, loadChatGptHttpConfig } from "./chatgptHttp.js";
import { loadChatGptMcpConfig } from "./chatgptMcp.js";

const httpConfig = loadChatGptHttpConfig();
const mcpConfig = loadChatGptMcpConfig();
const server = createChatGptHttpServer(httpConfig, mcpConfig);

server.listen(httpConfig.port, httpConfig.host, () => {
  const authHint = httpConfig.auth.mode === "bearer" ? "Bearer token required" : "no auth";
  console.log(`codex-chatgpt-mcp listening on http://${httpConfig.host}:${httpConfig.port}/mcp (${authHint})`);
});

function shutdown(signal: string): void {
  console.log(`received ${signal}, shutting down`);
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
