#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createChatGptMcpServer, loadChatGptMcpConfig } from "./chatgptMcp.js";

const server = createChatGptMcpServer(loadChatGptMcpConfig());
const transport = new StdioServerTransport();

await server.connect(transport);
