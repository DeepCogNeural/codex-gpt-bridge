#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { createHttpServer } from "./server.js";
import { CodexStdioUpstream } from "./upstream.js";

const config = loadConfig();
const upstream = new CodexStdioUpstream(config.codexCommand);
const server = createHttpServer(config, upstream);

server.listen(config.port, config.host, () => {
  const authHint = config.token && !config.noAuth ? "Bearer token required" : "no auth";
  console.log(`codex-gpt-bridge listening on http://${config.host}:${config.port}/mcp (${authHint})`);
  console.log(`allowed roots: ${config.allowedRoots.join(", ")}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`received ${signal}, shutting down`);
  server.close();
  await upstream.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
