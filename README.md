# codex-gpt-bridge

Small Streamable HTTP MCP bridge from ChatGPT/GPTs to local Codex.

Plain meaning: ChatGPT can act as the planner, while this local server forwards only scoped execution requests to the official `codex mcp-server` running on your machine.

## Why

Codex already ships a stdio MCP server with two useful tools:

- `codex`: start a local Codex session.
- `codex-reply`: continue a Codex session by thread id.

ChatGPT Apps/GPTs need an HTTP-accessible MCP endpoint. This project is the small missing adapter: HTTP MCP in, official Codex MCP out, with local safety policy in the middle.

## Safety defaults

- Binds to `127.0.0.1` by default.
- Accepts `codex_run.cwd` only under the configured roots. This is a bridge-level starting-directory gate, not OS-level file isolation.
- Uses Codex `read-only` sandbox by default.
- Requires either `CODEX_GPT_BRIDGE_TOKEN` or explicit local-only `CODEX_GPT_BRIDGE_NO_AUTH=1`.
- Does not expose raw shell, process control, full Codex app-server, or arbitrary Codex config.
- Blocks delegation when sensitive-looking files such as `.env`, private keys, or `.pem` files are present under the requested working directory.
- Allows `codex_reply` only for threads first created through this bridge, and reruns the sensitive-file preflight before continuing them.
- Blocks `workspace-write` unless `CODEX_GPT_BRIDGE_ALLOW_WRITE=1`.
- Blocks `danger-full-access` unless `CODEX_GPT_BRIDGE_ALLOW_DANGER=1`.

## Install

```bash
npm install
npm run build
```

Codex CLI must be installed and logged in:

```bash
codex --version
codex mcp-server --help
```

## Run locally

From the repo you want ChatGPT to delegate into:

```bash
CODEX_GPT_BRIDGE_NO_AUTH=1 \
CODEX_GPT_BRIDGE_ROOTS="$PWD" \
npm run dev
```

Server:

```text
http://127.0.0.1:8765/mcp
```

For a non-local bind:

```bash
export CODEX_GPT_BRIDGE_TOKEN="$(openssl rand -hex 32)"
CODEX_GPT_BRIDGE_HOST=0.0.0.0 \
CODEX_GPT_BRIDGE_ROOTS="/Users/me/project" \
npm run start
```

Use `Authorization: Bearer <token>` from your MCP client.

## ChatGPT connection

For ChatGPT Apps/GPTs, expose the local MCP endpoint with one of:

- OpenAI Secure MCP Tunnel.
- Cloudflare Tunnel.
- ngrok.

Then configure the ChatGPT app/connector MCP URL to the HTTPS `/mcp` endpoint. Keep the bridge bound to local host where possible and put the tunnel on top.

Built-in bearer-token auth is intended for local development, manual MCP clients, or a trusted proxy. Production ChatGPT Apps that require protected-tool auth should put an OAuth 2.1 / PKCE layer in front of this bridge; OAuth is not implemented in v0.1.

## Tools exposed to ChatGPT

### `bridge_status`

Reports bridge policy, allowed roots, and upstream Codex MCP tool availability.

### `codex_run`

Starts a Codex session in an allowed working directory.

Required:

- `prompt`
- `cwd`

Optional:

- `sandbox`: `read-only`, `workspace-write`, or `danger-full-access`
- `timeoutMs`

Approval policy is owner-controlled through `CODEX_GPT_BRIDGE_APPROVAL_POLICY`; callers cannot lower it per request.

Sensitive file preflight:

`codex_run` refuses to start if it finds common secret files under `cwd`, including `.env`, `.npmrc`, `.netrc`, private SSH key names, `.pem`, `.key`, `.p12`, and `.pfx` files. Disable only for a deliberately sanitized environment:

```bash
CODEX_GPT_BRIDGE_DISABLE_SECRET_SCAN=1 codex-gpt-bridge
```

### `codex_reply`

Continues a Codex session that was first created through this bridge.

Required:

- `threadId`
- `prompt`

The bridge rejects unknown thread ids and reruns the sensitive-file preflight against the original session directory before forwarding the reply.

Tracked sessions are in memory only, capped at 1000 entries, and expire after 6 hours. Restarting the bridge clears them.

## Development

```bash
npm run check
```

The tests use a fake upstream and do not call the real model.

## Existing project comparison

`riccilnl/colameta` is highly related and much broader: ChatGPT/GPTs to local executors, plan management, preview/apply, reports, and Git closure. It is alpha and its license text forbids commercial use, so this project does not copy its code.

`tuannvm/codex-mcp-server` is a mature Claude-to-Codex wrapper. It is useful prior art, but this project targets ChatGPT HTTP MCP and safety policy around the official Codex MCP server.
