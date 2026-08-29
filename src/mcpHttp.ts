import { createServer, type Server as HttpServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { NextFunction, Request, Response } from "express";

export type McpHttpAuth = { mode: "off" } | { mode: "bearer"; token: string };

export type StatelessMcpHttpOptions = {
  name: string;
  host: string;
  allowedHosts?: string[];
  auth: McpHttpAuth;
  oauthMetadataMessage?: string;
  createMcpServer: () => McpServer;
};

export type McpRequestSummary = {
  jsonrpc?: string;
  method?: string;
  id?: string | number | null;
  toolName?: string;
  paramKeys?: string[];
  promptChars?: number;
  clientName?: string;
  clientVersion?: string;
};

export function isBearerAuthorized(header: string | undefined, auth: McpHttpAuth): boolean {
  if (auth.mode === "off") {
    return true;
  }
  return header === `Bearer ${auth.token}`;
}

export function summarizeMcpRequestBody(body: unknown): McpRequestSummary {
  if (!body || typeof body !== "object") {
    return {};
  }

  const message = body as Record<string, unknown>;
  const summary: McpRequestSummary = {
    jsonrpc: typeof message.jsonrpc === "string" ? message.jsonrpc : undefined,
    method: typeof message.method === "string" ? message.method : undefined,
    id: message.id as string | number | null | undefined
  };

  const params = message.params;
  if (!params || typeof params !== "object") {
    return summary;
  }

  const paramsRecord = params as Record<string, unknown>;
  if (typeof paramsRecord.name === "string") {
    summary.toolName = paramsRecord.name;
  }

  const clientInfo = paramsRecord.clientInfo;
  if (clientInfo && typeof clientInfo === "object") {
    const client = clientInfo as Record<string, unknown>;
    if (typeof client.name === "string") {
      summary.clientName = client.name;
    }
    if (typeof client.version === "string") {
      summary.clientVersion = client.version;
    }
  }

  const args = paramsRecord.arguments;
  if (!args || typeof args !== "object") {
    return summary;
  }

  const argsRecord = args as Record<string, unknown>;
  summary.paramKeys = Object.keys(argsRecord);
  if (typeof argsRecord.prompt === "string") {
    summary.promptChars = argsRecord.prompt.length;
  }

  return summary;
}

function logMcpEvent(serverName: string, event: string, details: Record<string, unknown>): void {
  console.log(`[${serverName}] mcp.${event} ${JSON.stringify(details)}`);
}

function requestContext(req: Request): Record<string, unknown> {
  return {
    httpMethod: req.method,
    remoteAddress: req.socket.remoteAddress,
    host: req.headers.host,
    userAgent: req.headers["user-agent"],
    contentType: req.headers["content-type"],
    contentLength: req.headers["content-length"],
    hasAuthorization: Boolean(req.headers.authorization)
  };
}

export function createStatelessMcpHttpServer(options: StatelessMcpHttpOptions): HttpServer {
  const app = createMcpExpressApp({
    allowedHosts: options.allowedHosts,
    host: options.host
  });

  if (options.oauthMetadataMessage) {
    const message = options.oauthMetadataMessage;
    app.get(
      ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"],
      (_req: Request, res: Response) => {
        res.status(404).json({
          error: "oauth_metadata_not_configured",
          message
        });
      }
    );
  }

  app.get("/healthz", (_req: Request, res: Response) => {
    res.json({
      ok: true,
      name: options.name
    });
  });

  app.use("/mcp", (req: Request, res: Response, next: NextFunction) => {
    if (isBearerAuthorized(req.headers.authorization, options.auth)) {
      next();
      return;
    }
    logMcpEvent(options.name, "auth_denied", requestContext(req));
    res.status(401).json({
      error: "unauthorized"
    });
  });

  app.post("/mcp", async (req: Request, res: Response) => {
    const started = Date.now();
    const summary = summarizeMcpRequestBody(req.body);
    logMcpEvent(options.name, "request", {
      ...requestContext(req),
      ...summary
    });

    res.on("finish", () => {
      logMcpEvent(options.name, "response", {
        statusCode: res.statusCode,
        durationMs: Date.now() - started,
        jsonrpcMethod: summary.method,
        jsonrpcId: summary.id ?? null,
        toolName: summary.toolName ?? null
      });
    });

    const server = options.createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logMcpEvent(options.name, "error", {
        durationMs: Date.now() - started,
        jsonrpcMethod: summary.method,
        jsonrpcId: summary.id ?? null,
        toolName: summary.toolName ?? null,
        message: error instanceof Error ? error.message : String(error)
      });
      console.error(`[${options.name}] MCP request failed:`, error);
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

  app.get("/mcp", (req: Request, res: Response) => {
    logMcpEvent(options.name, "method_not_allowed", {
      ...requestContext(req),
      allowedMethods: ["POST"]
    });
    res.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed."
      },
      id: null
    });
  });

  app.delete("/mcp", (req: Request, res: Response) => {
    logMcpEvent(options.name, "method_not_allowed", {
      ...requestContext(req),
      allowedMethods: ["POST"]
    });
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
