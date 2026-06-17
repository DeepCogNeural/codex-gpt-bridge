# Security model

This bridge is intentionally smaller than a general remote-control daemon.

## What ChatGPT can do

- Ask for bridge policy with `bridge_status`.
- Start a Codex MCP session with `codex_run`.
- Continue that session with `codex_reply`.

## What ChatGPT cannot do through this bridge

- Run raw shell commands directly.
- Start a new Codex session from a `cwd` outside `CODEX_GPT_BRIDGE_ROOTS`.
- Continue arbitrary Codex threads that were not first created through this bridge.
- Continue tracked Codex threads forever; tracked sessions are in memory, capped at 1000 entries, and expire after 6 hours.
- Change Codex config through an arbitrary `config` object.
- Start `codex_run` when common sensitive files are present under `cwd`, unless secret scanning is explicitly disabled.
- Use `workspace-write` unless the bridge owner explicitly enables it.
- Use `danger-full-access` unless the bridge owner explicitly enables it.

## Defaults

- Host: `127.0.0.1`
- Port: `8765`
- Allowed root: current working directory
- Codex sandbox: `read-only`
- Approval policy: `never`

## Public tunnel rule

Set `CODEX_GPT_BRIDGE_TOKEN` unless you are doing explicit local-only development with `CODEX_GPT_BRIDGE_NO_AUTH=1`. `NO_AUTH` is rejected on non-local host bindings. For tunnels, keep the bridge bound to `127.0.0.1` and let the tunnel provide the public HTTPS endpoint.

Bearer-token auth is not a production ChatGPT Apps auth implementation. If your ChatGPT surface requires protected tools, place an OAuth 2.1 / PKCE proxy in front of this bridge.

## Remaining risk

Any bridge from ChatGPT to a local coding agent can cause local actions if you enable write mode. Keep the allowed roots narrow, inspect Codex output, and prefer read-only until the task truly needs edits.

`CODEX_GPT_BRIDGE_ROOTS` is not OS-level file isolation. It only limits the starting `cwd` accepted by this bridge. For hard read/write isolation, use a sanitized staging copy, a separate OS user/container, or a Codex permission profile that denies sensitive paths.

The built-in sensitive file preflight only blocks obvious filenames and extensions. For high-risk repositories, create a sanitized staging copy before exposing the path to ChatGPT.
