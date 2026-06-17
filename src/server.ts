import { createServer, type Server as HttpServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { NextFunction, Request, Response } from "express";
import type { BridgeConfig } from "./config.js";
import type { CodexUpstream } from "./upstream.js";
import { registerBridgeTools } from "./tools.js";
import { SessionRegistry } from "./sessionRegistry.js";

export function createBridgeMcpServer(
  config: BridgeConfig,
  upstream: CodexUpstream,
  sessions = new SessionRegistry()
): McpServer {
  const server = new McpServer(
    {
      name: "codex-gpt-bridge",
      title: "Codex GPT Bridge",
      version: "0.1.0"
    },
    {
      instructions:
        "Use codex_run only for tasks inside allowed roots. The bridge enforces sandbox and cwd policy. Do not request secrets or broad system access."
    }
  );
  registerBridgeTools(server, config, upstream, sessions);
  return server;
}

export function createHttpServer(config: BridgeConfig, upstream: CodexUpstream): HttpServer {
  const app = createMcpExpressApp({
    allowedHosts: config.allowedHosts,
    host: config.host
  });
  const sessions = new SessionRegistry();

  app.get(
    ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"],
    (_req: Request, res: Response) => {
      res.status(404).json({
        error: "oauth_metadata_not_configured",
        message: "This local bridge runs with No Auth when it is behind OpenAI Secure MCP Tunnel."
      });
    }
  );

  app.get("/healthz", (_req: Request, res: Response) => {
    res.json({
      ok: true,
      name: "codex-gpt-bridge"
    });
  });

  app.use("/mcp", (req: Request, res: Response, next: NextFunction) => {
    if (isAuthorized(req.headers.authorization, config)) {
      next();
      return;
    }
    res.status(401).json({
      error: "unauthorized"
    });
  });

  app.post("/mcp", async (req: Request, res: Response) => {
    const server = createBridgeMcpServer(config, upstream, sessions);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP request failed:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error"
          },
          id: null
        });
      }
    } finally {
      await transport.close();
      await server.close();
    }
  });

  app.get("/mcp", (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed."
      },
      id: null
    });
  });

  app.delete("/mcp", (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed."
      },
      id: null
    });
  });

  return createServer(app);
}

function isAuthorized(header: string | undefined, config: BridgeConfig): boolean {
  if (config.noAuth) {
    return true;
  }
  return header === `Bearer ${config.token}`;
}
