# TASK_STATE

## Goal

Help the user actually use and test `codex-gpt-bridge`: a small Streamable HTTP MCP bridge that lets ChatGPT/GPTs call local Codex through the official `codex mcp-server`.

## Current Status

- Valid as of: 2026-06-17 11:39:02 EDT.
- Repository: `https://github.com/DeepCogNeural/codex-gpt-bridge`.
- Branch: `main`.
- Latest commit before this state update: `ac4ed38 Initial codex gpt bridge`.
- Local worktree was clean before the state update.
- Current testing policy: read-only only; do not enable `workspace-write` or `danger-full-access`.

## Facts

- Local Codex CLI is `codex-cli 0.134.0`.
- `codex mcp-server` is available and exposes upstream tools `codex` and `codex-reply`.
- Bridge tools exposed over HTTP MCP: `bridge_status`, `codex_run`, `codex_reply`.
- Default bridge policy remains `read-only`, `approval-policy=never`, `allowWorkspaceWrite=false`, `allowDangerFullAccess=false`.
- `CODEX_GPT_BRIDGE_NO_AUTH=1` is acceptable only for localhost testing. Public/tunnel usage should use bearer token or an OAuth/PKCE proxy.

## Verification

- `npm run check` passed on 2026-06-17: TypeScript build plus 15 Vitest tests.
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

- `TASK_STATE.md` updated with the current read-only smoke verification.

## Next Step

If the user wants ChatGPT/GPTs to call this bridge directly, expose `http://127.0.0.1:8876/mcp` through a secure HTTPS tunnel, configure the MCP URL in ChatGPT/GPTs, call `bridge_status` first, then run a read-only `codex_run`.

## Cautions

- Do not put secrets in prompts or logs.
- Do not disable secret scanning unless the working directory is deliberately sanitized.
- Do not expose a no-auth endpoint outside localhost.
- Do not enable write mode until the read-only ChatGPT-side workflow is proven.
