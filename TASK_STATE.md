# TASK_STATE

## Goal

Help the user actually use and test `codex-gpt-bridge`: a small Streamable HTTP MCP bridge that lets ChatGPT/GPTs call local Codex through the official `codex mcp-server`.

Current clarified goal: determine and run the best bridge for two directions:

1. Primary: Codex calls ChatGPT without Computer Use, ideally as an MCP-like tool or other stable programmatic connector.
2. Fallback: ChatGPT calls Codex through the existing MCP bridge, using the user's multi-dialog Superpower workflow.

## Current Status

- Valid as of: 2026-06-17 14:10:00 EDT.
- Repository: `https://github.com/DeepCogNeural/codex-gpt-bridge`.
- Branch: `main`.
- Latest pushed commit for this state update: `Add one-command ChatGPT bridge launcher`.
- Current testing policy: read-only only; do not enable `workspace-write` or `danger-full-access`.
- User authorized completing the ChatGPT Developer Mode connector setup without further confirmation. Keep public no-auth tunnel use short-lived and read-only.
- Update valid as of 2026-06-17 14:50 EDT: user wants the least-annoying ChatGPT UI -> local Codex workflow. This project is an MCP bridge. ChatGPT cannot directly call `localhost`; it needs either OpenAI Secure MCP Tunnel or an HTTPS tunnel.
- Best daily path is OpenAI Secure MCP Tunnel. `tunnel-client` is installed at `/Users/linghao/.local/bin/tunnel-client` and reports version `0.0.9+62b9b42f698ec5319d2115e0c0ff1dcf6557d7ae`.
- OpenAI Platform tunnel setup is blocked at Google account selection in Chrome. The tab is left open for user handoff because choosing a specific Google account is an account-authorization action.
- Temporary Cloudflare quick tunnel is unreliable today: multiple generated `trycloudflare.com` names did not resolve in DNS. The launcher now retries and reports the real last error.

## Facts

- Local Codex CLI is `codex-cli 0.134.0`.
- `codex mcp-server` is available and exposes upstream tools `codex` and `codex-reply`.
- Bridge tools exposed over HTTP MCP: `bridge_status`, `codex_run`, `codex_reply`.
- Codex-to-model path now exists as project-scoped stdio MCP server `chatgpt`, exposing `ask_chatgpt`.
- `ask_chatgpt` calls the official OpenAI Responses API. It is not the ChatGPT web UI and not a private ChatGPT product backend.
- `OPENAI_API_KEY` is required for real `ask_chatgpt` calls. It is forwarded through `.codex/config.toml` `env_vars`, not written into the repo.
- Default bridge policy remains `read-only`, `approval-policy=never`, `allowWorkspaceWrite=false`, `allowDangerFullAccess=false`.
- `CODEX_GPT_BRIDGE_NO_AUTH=1` is acceptable only for localhost testing. Public/tunnel usage should use bearer token or an OAuth/PKCE proxy.
- `CODEX_GPT_BRIDGE_ALLOWED_HOSTS` is needed when an HTTPS tunnel forwards a non-local Host header to a localhost-bound bridge.
- Tool annotations now advertise read-only/non-destructive metadata when the bridge is configured read-only.

## Verification

- `npm run check` passed on 2026-06-17 after Codex-to-model MCP addition: TypeScript build plus 18 Vitest tests.
- `npm run check` passed on 2026-06-17 after tunnel host + tool annotation additions: TypeScript build plus 21 Vitest tests.
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
- Temporary Cloudflare quick tunnel was started with `npx -y cloudflared tunnel --url http://127.0.0.1:8876`.
- Tunnel URL used for the UI smoke test: `https://phpbb-smithsonian-comics-future.trycloudflare.com/mcp`.
- Initial tunnel health check failed with MCP SDK DNS-rebinding protection: `Invalid Host: phpbb-smithsonian-comics-future.trycloudflare.com`.
- After adding `CODEX_GPT_BRIDGE_ALLOWED_HOSTS=127.0.0.1,localhost,phpbb-smithsonian-comics-future.trycloudflare.com`, `curl https://phpbb-smithsonian-comics-future.trycloudflare.com/healthz` returned `{"ok":true,"name":"codex-gpt-bridge"}`.
- SDK Streamable HTTP client connected through the tunnel and listed tools `bridge_status,codex_run,codex_reply`.
- ChatGPT Developer Mode app `Local Codex Bridge` was created and connected with:
  - Server URL: `https://phpbb-smithsonian-comics-future.trycloudflare.com/mcp`
  - Authentication: `No Auth`
  - ChatGPT App Id: `asdk_app_6a32e194a70881919a6b32299c71cbb0`
  - ChatGPT Version Id: `asdk_app_v_6a32e198e09c81919214894629e3145c`
- ChatGPT UI -> bridge `bridge_status` succeeded and returned allowed root `/Users/linghao/Github/codex-gpt-bridge`, `read-only`, no write/danger permissions, and upstream tools `codex,codex-reply`.
- ChatGPT UI -> bridge `codex_run` succeeded in read-only mode; Codex read `README.md` and `package.json`, summarized scripts, and reported no file modifications.
- ChatGPT UI -> bridge `codex_reply` succeeded for thread `019ed6c2-f060-72b0-849c-d7025fee873d`; it returned package name `codex-gpt-bridge`, version `0.1.0`, and reported no file modifications.
- After adding annotations and restarting the bridge, SDK listTools showed all three tools with `readOnlyHint:true`, `destructiveHint:false`, and `openWorldHint:false`.
- ChatGPT app metadata Refresh succeeded. ChatGPT Developer Mode now labels `bridge_status`, `codex_run`, and `codex_reply` as `Read`; old `PUBLIC WRITE`, `Open world`, `Destructive`, and `Poor Description` warnings disappeared. Remaining warning: `Output schema recommended`.
- `git status --short` had no output after read-only smoke tests.
- Local launcher smoke passed on port `8899`: `npm run bridge:chatgpt:local -- --port 8899 --root /Users/linghao/Github/codex-gpt-bridge --no-build`, `/healthz` returned 200, and MCP SDK listed `bridge_status,codex_run,codex_reply`.
- Manual Cloudflare quick tunnel smoke passed once on port `8900` when the bridge was started with the exact generated tunnel host in `CODEX_GPT_BRIDGE_ALLOWED_HOSTS`; `/healthz` returned 200 and MCP SDK listed `bridge_status,codex_run,codex_reply`.
- One-command quick launcher retries were tested on port `8903`; all 3 Cloudflare attempts failed because their generated `trycloudflare.com` DNS names did not resolve. This validates the new retry/error reporting but confirms quick tunnel is not suitable as the daily path on the current network.
- `npm run check` passed on 2026-06-17 after adding the one-command ChatGPT launcher: TypeScript build plus 21 Vitest tests.

## Current Runtime

- Temporary localhost bridge server has been stopped. `curl http://127.0.0.1:8876/healthz` now fails to connect.
- Temporary Cloudflare quick tunnel has been stopped. The tunnel host now returns Cloudflare 1033, so the public no-auth endpoint is no longer reachable.
- Default port `8765` returned `EADDRINUSE` during this test. `lsof` did not show a listener at the moment checked, so treat that as a transient or hidden-port state and prefer an explicit fallback port if it recurs.
- No bridge or Cloudflare tunnel process from the latest launcher smoke tests is intentionally left running.
- Chrome has an OpenAI/Google account chooser tab left open for Secure MCP Tunnel setup handoff.

## Changed Files

- `.codex/config.toml` added project-scoped Codex MCP config for `chatgpt`.
- `src/chatgptMcp.ts` and `src/chatgpt-cli.ts` added the Codex-to-OpenAI Responses API stdio MCP server.
- `test/chatgptMcp.test.ts` added tool registration/request-shaping/missing-key tests.
- `package.json` added `codex-chatgpt-mcp` bin and `chatgpt:mcp` script.
- `README.md` documented both directions and the boundary that Codex-to-model is API-backed, not ChatGPT web UI.
- `src/config.ts` added `CODEX_GPT_BRIDGE_ALLOWED_HOSTS`.
- `src/server.ts` passes `allowedHosts` and `host` to `createMcpExpressApp`.
- `src/tools.ts` adds safer descriptions and MCP tool annotations.
- `test/config.test.ts` covers allowed host parsing.
- `test/tools.test.ts` covers read-only/write-enabled tool annotations.
- `scripts/start-chatgpt-codex-bridge.mjs` added a one-command launcher for local, quick Cloudflare tunnel, and OpenAI Secure MCP Tunnel modes.
- `package.json` added `bridge:chatgpt`, `bridge:chatgpt:local`, and `bridge:chatgpt:secure` scripts.
- `docs/chatgpt-setup.md`, `docs/security.md`, and `README.md` document the MCP setup, quick fallback, and Secure MCP Tunnel daily path.
- `TASK_STATE.md` updated with the current verification.

## Next Step

Next step:

1. User selects the intended Google account in the kept Chrome OpenAI Platform login tab.
2. Create/copy an OpenAI Secure MCP Tunnel id and a runtime API key with Tunnels Read + Use.
3. Run `CONTROL_PLANE_API_KEY=... CONTROL_PLANE_TUNNEL_ID=... npm run bridge:chatgpt:secure`.
4. In ChatGPT Settings -> Apps -> Local Codex Bridge -> Manage, set Connection = Tunnel and Refresh.
5. After the tunnel is connected, verify from ChatGPT UI with `@Local Codex Bridge 调用 bridge_status`.

## Cautions

- Do not put secrets in prompts or logs.
- Do not disable secret scanning unless the working directory is deliberately sanitized.
- Do not expose a no-auth endpoint outside localhost.
- Do not enable write mode until the read-only ChatGPT-side workflow is proven.
