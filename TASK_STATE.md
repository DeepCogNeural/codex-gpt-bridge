# TASK_STATE

## Goal

Build a clean open-source project that lets ChatGPT/GPTs call a controlled local Codex executor through MCP.

## Current Plan

- Implement a small TypeScript Streamable HTTP MCP server.
- Use official `codex mcp-server` as the upstream executor.
- Expose only scoped tools: status, run Codex, reply to Codex.
- Enforce bearer token or explicit local no-auth, allowed cwd roots, tracked Codex sessions, sensitive-file preflight, and sandbox policy.
- Push to a new GitHub repository under `DeepCogNeural`.

## Facts

- Local Codex CLI is `codex-cli 0.134.0`.
- `codex mcp-server` exposes `codex` and `codex-reply` over stdio MCP.
- OpenAI docs say ChatGPT Apps/GPTs connect through MCP over HTTPS; local development should use Secure MCP Tunnel or another HTTPS tunnel.
- `riccilnl/colameta` is highly related but alpha and non-commercial licensed.

## Changed Files

- Initial TypeScript project scaffold under `/Users/linghao/Github/codex-gpt-bridge`.
- Final reviewer fixes: explicit auth, tracked `codex_reply`, no ChatGPT-side model/developer-instruction/approval-policy override, symlink-sensitive preflight, clarified docs.

## Verification

- `npm run check` passed: TypeScript build plus 15 Vitest tests across config, tools, and HTTP auth.
- Real HTTP MCP smoke test passed against local `/mcp`: SDK client discovered `bridge_status`, `codex_run`, and `codex_reply`; `bridge_status` reached the local official `codex mcp-server`.
- HTML decision report generated; `check_html_artifact.py` and `check_artifact_json.py` passed after final reviewer fixes.
- Final adversarial review found no remaining code/security blockers; only publish closure remained.

## Blockers

- None currently.

## Next Step

Create the initial commit, create the public GitHub remote, and push `main`.
