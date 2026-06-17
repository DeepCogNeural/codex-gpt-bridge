# TASK_STATE

## Goal

Help the user actually use and test `codex-gpt-bridge`: a small Streamable HTTP MCP bridge that lets ChatGPT/GPTs call local Codex through the official `codex mcp-server`.

Current clarified goal: determine and run the best bridge for two directions:

1. Primary: Codex calls ChatGPT without Computer Use, ideally as an MCP-like tool or other stable programmatic connector.
2. Fallback: ChatGPT calls Codex through the existing MCP bridge, using the user's multi-dialog Superpower workflow.

## Current Status

- Valid as of: 2026-06-17 12:05:00 EDT.
- Repository: `https://github.com/DeepCogNeural/codex-gpt-bridge`.
- Branch: `main`.
- Latest commit before this state update: `ac4ed38 Initial codex gpt bridge`.
- Local worktree was clean before the state update.
- Current testing policy: read-only only; do not enable `workspace-write` or `danger-full-access`.
- User opened ChatGPT Developer mode. Do not create or approve any persistent connector beyond read-only testing without reporting the exact endpoint and risk.

## Facts

- Local Codex CLI is `codex-cli 0.134.0`.
- `codex mcp-server` is available and exposes upstream tools `codex` and `codex-reply`.
- Bridge tools exposed over HTTP MCP: `bridge_status`, `codex_run`, `codex_reply`.
- Codex-to-model path now exists as project-scoped stdio MCP server `chatgpt`, exposing `ask_chatgpt`.
- `ask_chatgpt` calls the official OpenAI Responses API. It is not the ChatGPT web UI and not a private ChatGPT product backend.
- `OPENAI_API_KEY` is required for real `ask_chatgpt` calls. It is forwarded through `.codex/config.toml` `env_vars`, not written into the repo.
- Default bridge policy remains `read-only`, `approval-policy=never`, `allowWorkspaceWrite=false`, `allowDangerFullAccess=false`.
- `CODEX_GPT_BRIDGE_NO_AUTH=1` is acceptable only for localhost testing. Public/tunnel usage should use bearer token or an OAuth/PKCE proxy.

## Verification

- `npm run check` passed on 2026-06-17 after Codex-to-model MCP addition: TypeScript build plus 18 Vitest tests.
- Project-scoped `codex mcp list --json` shows `chatgpt` enabled with stdio command `npm run chatgpt:mcp` and forwarded env vars `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `CODEX_CHATGPT_MODEL`, `CODEX_CHATGPT_TIMEOUT_MS`.
- Local stdio MCP smoke using `npm run chatgpt:mcp` returned tool list `ask_chatgpt`; with no `OPENAI_API_KEY`, the tool returned the expected missing-key error.
- `ask_chatgpt` `reasoningEffort` is constrained for the default `gpt-5.5` path to `none`, `low`, `medium`, `high`, and `xhigh`; tests cover `xhigh` pass-through and reject `minimal`.
- Local ChatGPT-to-Codex HTTP MCP smoke passed after the Codex-to-model addition: `/healthz` returned 200, tools were `bridge_status,codex_run,codex_reply`, and `bridge_status` saw upstream `codex`/`codex-reply`.
- No `OPENAI_API_KEY`, `AGENT_ACCESS_TOKEN`, `CODEX_GPT_BRIDGE_TOKEN`, `ngrok`, `cloudflared`, or Secure MCP Tunnel client is available in the current shell.
- Local bridge started successfully on fallback port `8876`:
  - `CODEX_GPT_BRIDGE_NO_AUTH=1`
  - `CODEX_GPT_BRIDGE_ROOTS=/Users/linghao/Github/codex-gpt-bridge`
  - `CODEX_GPT_BRIDGE_DEFAULT_SANDBOX=read-only`
- SDK Streamable HTTP client connected to `http://127.0.0.1:8876/mcp`.
- `client.listTools()` returned `bridge_status,codex_run,codex_reply`.
- `bridge_status` confirmed allowed root, read-only default policy, no write/danger permission, and reachable official upstream Codex MCP tools.
- Real `codex_run` read-only smoke passed. Codex read `README.md` and `package.json`, reported `npm run check`, and stated it did not modify files.
- Real `codex_reply` smoke passed for bridge-created thread `019ed63b-c38e-76b0-8944-e15208b20e84`.
- Negative safety checks passed:
  - Unknown `codex_reply` thread id was rejected.
  - `codex_run` with `sandbox=workspace-write` was rejected before upstream execution.
- `curl http://127.0.0.1:8876/healthz` returned `{"ok":true,"name":"codex-gpt-bridge"}`.
- `git status --short` had no output after read-only smoke tests.

## Current Runtime

- A local dev server may still be running in this Codex session on `http://127.0.0.1:8876/mcp`.
- Default port `8765` returned `EADDRINUSE` during this test. `lsof` did not show a listener at the moment checked, so treat that as a transient or hidden-port state and prefer an explicit fallback port if it recurs.

## Changed Files

- `.codex/config.toml` added project-scoped Codex MCP config for `chatgpt`.
- `src/chatgptMcp.ts` and `src/chatgpt-cli.ts` added the Codex-to-OpenAI Responses API stdio MCP server.
- `test/chatgptMcp.test.ts` added tool registration/request-shaping/missing-key tests.
- `package.json` added `codex-chatgpt-mcp` bin and `chatgpt:mcp` script.
- `README.md` documented both directions and the boundary that Codex-to-model is API-backed, not ChatGPT web UI.
- `TASK_STATE.md` updated with the current verification.

## Next Step

Next step:

1. Set `OPENAI_API_KEY` in the Codex app environment, then open a fresh Codex thread in this project and call the `chatgpt.ask_chatgpt` MCP tool.
2. To finish ChatGPT UI -> Codex, install/configure Secure MCP Tunnel, ngrok, or Cloudflare Tunnel, start `codex-gpt-bridge`, expose `/mcp` over HTTPS, and configure the ChatGPT Developer Mode app.

## Cautions

- Do not put secrets in prompts or logs.
- Do not disable secret scanning unless the working directory is deliberately sanitized.
- Do not expose a no-auth endpoint outside localhost.
- Do not enable write mode until the read-only ChatGPT-side workflow is proven.
