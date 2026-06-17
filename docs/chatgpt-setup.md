# ChatGPT setup

MCP means Model Context Protocol: ChatGPT calls tools exposed by an MCP server. This bridge is the MCP server ChatGPT talks to; local Codex remains the executor behind it.

## Local-only dry run

From the repository you want Codex to inspect:

```bash
CODEX_GPT_BRIDGE_NO_AUTH=1 \
CODEX_GPT_BRIDGE_ROOTS="$PWD" \
codex-gpt-bridge
```

`CODEX_GPT_BRIDGE_NO_AUTH=1` is only accepted on local host bindings.

Then test locally:

```bash
curl http://127.0.0.1:8765/healthz
```

## ChatGPT-visible endpoint

ChatGPT needs an HTTPS MCP URL. Prefer OpenAI Secure MCP Tunnel when available. A generic tunnel also works for local development.

For production ChatGPT Apps with protected tools, place an OAuth 2.1 / PKCE proxy in front of this bridge. This project does not implement OAuth in v0.1.

For manual MCP clients or a trusted development proxy, use a bridge bearer token:

```bash
export CODEX_GPT_BRIDGE_TOKEN="$(openssl rand -hex 32)"
CODEX_GPT_BRIDGE_ROOTS="/absolute/path/to/repo" codex-gpt-bridge
```

Expose only `http://127.0.0.1:8765/mcp` through the tunnel and configure ChatGPT with the resulting HTTPS `/mcp` URL.

Authentication:

```text
Authorization: Bearer <CODEX_GPT_BRIDGE_TOKEN>
```

## First tool call

Call `bridge_status` first. It proves ChatGPT reached this bridge and this bridge reached the local official `codex mcp-server`.

Only then call `codex_run` with:

```json
{
  "cwd": "/absolute/path/to/repo",
  "prompt": "Inspect this repository and summarize the test command. Do not edit files.",
  "sandbox": "read-only"
}
```

If `codex_run` reports sensitive-looking files, move those files outside the allowed root or create a sanitized staging copy. Disabling the preflight is possible but should be treated as accepting that ChatGPT/Codex may read those local files.

Allowed roots only control which `cwd` values the bridge accepts. They are not a hard filesystem sandbox.

`codex_reply` only works for sessions created through the same running bridge process. Those records are in memory, capped at 1000 entries, and expire after 6 hours.

## Write mode

Write mode is intentionally off by default.

To allow workspace edits inside allowed roots:

```bash
CODEX_GPT_BRIDGE_ALLOW_WRITE=1 \
CODEX_GPT_BRIDGE_ROOTS="/absolute/path/to/repo" \
codex-gpt-bridge
```

Do not expose `danger-full-access` through a public tunnel unless you have an external sandbox and a clear reason.
