import { describe, expect, it } from "vitest";
import { summarizeMcpRequestBody } from "../src/mcpHttp.js";

describe("summarizeMcpRequestBody", () => {
  it("summarizes initialize requests", () => {
    expect(
      summarizeMcpRequestBody({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          clientInfo: {
            name: "cursor",
            version: "1.0.0"
          }
        }
      })
    ).toEqual({
      jsonrpc: "2.0",
      method: "initialize",
      id: 1,
      clientName: "cursor",
      clientVersion: "1.0.0"
    });
  });

  it("summarizes tools/call without logging prompt text", () => {
    expect(
      summarizeMcpRequestBody({
        jsonrpc: "2.0",
        id: "call-1",
        method: "tools/call",
        params: {
          name: "ask_chatgpt",
          arguments: {
            prompt: "secret prompt",
            reasoningEffort: "low"
          }
        }
      })
    ).toEqual({
      jsonrpc: "2.0",
      method: "tools/call",
      id: "call-1",
      toolName: "ask_chatgpt",
      paramKeys: ["prompt", "reasoningEffort"],
      promptChars: 13
    });
  });
});
