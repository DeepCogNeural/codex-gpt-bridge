# ChatGPT setup

MCP means Model Context Protocol: ChatGPT calls tools exposed by an MCP server. This bridge is the MCP server ChatGPT talks to; local Codex remains the executor behind it.

## Short answer

Yes, this is an MCP app for ChatGPT.

The convenient path is:

```text
ChatGPT UI -> Local Codex Bridge MCP -> local Codex MCP server -> Codex execution
```

Daily use after setup:

```bash
cd /Users/linghao/Github/codex-gpt-bridge
npm run bridge:chatgpt
```

Then in ChatGPT:

```text
@Local Codex Bridge 在 /Users/linghao/Github/codex-gpt-bridge 里只读检查 package.json，总结 scripts。
```

## Best long-term setup

Use OpenAI Secure MCP Tunnel. It keeps the local bridge private and lets ChatGPT call it through an OpenAI-hosted tunnel. This is the only clean setup where ChatGPT can keep the same app connection instead of changing a temporary Cloudflare URL.

One-time setup needs:

- `tunnel_id` from OpenAI Platform tunnel settings.
- `CONTROL_PLANE_API_KEY` with Tunnels Read + Use.
- `tunnel-client` installed locally.

Run:

```bash
export CONTROL_PLANE_API_KEY="sk-..."
export CONTROL_PLANE_TUNNEL_ID="tunnel_..."

cd /Users/linghao/Github/codex-gpt-bridge
npm run bridge:chatgpt:secure
```

In ChatGPT Settings -> Apps -> Local Codex Bridge -> Manage:

- Connection: `Tunnel`
- Tunnel: choose/paste your `tunnel_...`
- Authentication: `No Auth`
- Click `Refresh`

After that, keep `npm run bridge:chatgpt:secure` running while you use ChatGPT.

## Easy temporary setup

If Secure MCP Tunnel is not available on your account yet, use the one-command quick tunnel:

```bash
cd /Users/linghao/Github/codex-gpt-bridge
npm run bridge:chatgpt
```

It starts:

- local bridge on `127.0.0.1:8876`
- temporary Cloudflare HTTPS tunnel
- read-only Codex policy

Copy the printed `https://...trycloudflare.com/mcp` URL into ChatGPT:

- Settings -> Apps -> Local Codex Bridge -> Manage
- Server URL: printed `/mcp` URL
- Authentication: `No Auth`
- Refresh

This is convenient for testing, but the URL changes every run.
If it fails with `Could not resolve host: ...trycloudflare.com`, Cloudflare issued a bad temporary DNS name. The script retries automatically; for regular use, switch to Secure MCP Tunnel instead of relying on quick tunnel.

## Local-only dry run

From the bridge repository, pass the repository you want Codex to inspect:

```bash
cd /Users/linghao/Github/codex-gpt-bridge
npm run bridge:chatgpt:local -- --root /absolute/path/to/repo
```

`CODEX_GPT_BRIDGE_NO_AUTH=1` is only accepted on local host bindings.

Then test locally:

```bash
curl http://127.0.0.1:8876/healthz
```

## ChatGPT-visible endpoint details

ChatGPT needs an HTTPS MCP URL. Prefer OpenAI Secure MCP Tunnel when available. A generic tunnel also works for local development.

For production ChatGPT Apps with protected tools, place an OAuth 2.1 / PKCE proxy in front of this bridge. This project does not implement OAuth in v0.1.

For manual MCP clients or a trusted development proxy, use a bridge bearer token:

```bash
export CODEX_GPT_BRIDGE_TOKEN="$(openssl rand -hex 32)"
CODEX_GPT_BRIDGE_ROOTS="/absolute/path/to/repo" codex-gpt-bridge
```

Expose only the local `/mcp` endpoint through the tunnel and configure ChatGPT with the resulting HTTPS `/mcp` URL.

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
