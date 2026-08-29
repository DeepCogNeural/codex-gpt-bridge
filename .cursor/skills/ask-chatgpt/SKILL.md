---
name: ask-chatgpt-bridge
description: Project overlay for codex-gpt-bridge. Use with the personal ask-chatgpt skill. In this repo, ask_chatgpt is local HTTP/stdio MCP and must not be confused with Codex-bridge tools. Use when a problem in this repository is complex or you are stuck, in any Cursor mode. Plan Mode does not require a call.
---

# Ask ChatGPT (this repository)

Follow the personal skill `ask-chatgpt` for when to call, workflows A/B/C, effort policy, and prompt shape. This file only adds facts that are true in `codex-gpt-bridge`.

## This repo

- Implementation is `src/chatgptMcp.ts`. HTTP shell is `src/mcpHttp.ts`.
- Server process model comes from `CODEX_CHATGPT_MODEL`. Code fallback if unset is `gpt-5.5`. Docker Compose default is `gpt-5.6-sol`.
- This HTTP server is stateless. `GET /mcp` is 405. Progress rides the same POST or stdio call.
- Progress `message` JSON is `{ "kind": "reasoning" | "output", "text": "..." }` when the client sends a progress token.
- Codex-bridge tools (`bridge_status`, `codex_read`, `codex_run`, `codex_reply`, `codex_job_status`) are the other direction. Never call them as Sol.

Plan Mode does not require `ask_chatgpt`. Call it when the work is complex or you are stuck, same as in Agent mode.
