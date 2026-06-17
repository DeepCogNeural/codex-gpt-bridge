# TASK_STATE

## Goal

Help the user actually use and test `codex-gpt-bridge`: a small Streamable HTTP MCP bridge that lets ChatGPT/GPTs call local Codex through the official `codex mcp-server`.

Current clarified goal: determine and run the best bridge for two directions:

1. Primary: Codex calls ChatGPT without Computer Use, ideally as an MCP-like tool or other stable programmatic connector.
2. Fallback: ChatGPT calls Codex through the existing MCP bridge, using the user's multi-dialog Superpower workflow.

## Latest Update

- Valid as of: 2026-06-17 16:52 EDT.
- Screenshot failure root cause: the Secure MCP Tunnel control plane has an about-30s request deadline. A synchronous `codex_run` can keep running locally after ChatGPT has already returned `502 Upstream or external service errors`.
- Fix implemented: Codex calls now fast-return before the tunnel deadline with `status=running` + `jobId`; results can be fetched with `codex_job_status`.
- Daily read-only entry is now `codex_read`, not `codex_run`. `codex_read` forces Codex `read-only` and exposes no sandbox field, which avoids ChatGPT treating normal repo inspection as a write-capable tool.
- Default read-only `codex_run` schema now exposes only `sandbox=read-only`; `workspace-write` appears only when the bridge owner starts write mode.
- ChatGPT UI test after app Refresh passed:
  - `codex_read` started through `@Local Codex Bridge Secure` with only `prompt`.
  - It returned `status=running` and jobId `bf593488-db67-4158-8d11-1e75bf2527cb`, with no 502 and no file modification.
  - A precise user-authored `codex_job_status` prompt for that jobId succeeded and later returned `completed` with the expected repo summary.
- Important limitation: ChatGPT UI may block fully automatic chained polling when it tries to feed a jobId from one tool result into `codex_job_status` without the user explicitly restating the jobId. The practical workaround is to paste the exact jobId into the next prompt, or let Codex/local tooling query `codex_job_status` directly.
- Fixed agent flow is now documented in both `README.md` and `docs/chatgpt-setup.md`: `bridge_status` -> `codex_read` with only `prompt` -> exact `codex_job_status` when running -> `codex_reply` only after a completed thread id -> `codex_run` only for explicit write mode.
- Additional real local MCP smoke passed after the final docs/code update: `codex_read` through `http://127.0.0.1:8876/mcp` read `package.json` and returned package name `codex-gpt-bridge`, version `0.1.0`, with no file modifications.

## Current Status

- Valid as of: 2026-06-17 16:05:30 EDT.
- Repository: `https://github.com/DeepCogNeural/codex-gpt-bridge`.
- Branch: `main`.
- Previous pushed commit before this state update: `Add one-command ChatGPT bridge launcher`.
- Current testing policy: read-only only; do not enable `workspace-write` or `danger-full-access`.
- User authorized completing the ChatGPT Developer Mode connector setup without further confirmation. Keep public no-auth tunnel use short-lived and read-only.
- Update valid as of 2026-06-17 15:30 EDT: user wants the least-annoying ChatGPT UI -> local Codex workflow. The daily path is OpenAI Secure MCP Tunnel plus a macOS LaunchAgent; Cloudflare quick tunnel is no longer the recommended path.
- `tunnel-client` is installed at `/Users/linghao/.local/bin/tunnel-client` and reports version `0.0.9+62b9b42f698ec5319d2115e0c0ff1dcf6557d7ae`.
- OpenAI Platform tunnel setup is complete for tunnel `tunnel_6a32ef1f53e48191b094c12162632f4c`, named `codex-gpt-bridge-local`, associated with the user's ChatGPT workspace.
- Runtime credentials are stored in macOS Keychain under `codex-gpt-bridge:control-plane-api-key` and `codex-gpt-bridge:control-plane-tunnel-id`; no secret is written into the repository.
- ChatGPT Developer Mode app `Local Codex Bridge Secure` is created and connected with Connection = Tunnel, Authentication = No Auth.
- Use `Local Codex Bridge Secure` for daily work. The older Cloudflare-backed ChatGPT app `Local Codex Bridge` has been disconnected in ChatGPT Settings; the UI did not expose a physical Delete button.
- `codex_run.cwd` now defaults to the only configured allowed root, so daily ChatGPT prompts no longer need to repeat `cwd` or `sandbox` when the bridge has one allowed root.
- Write mode remains opt-in. Use `npm run bridge:chatgpt:secure:write:keychain` with a narrow `CODEX_GPT_BRIDGE_ROOT` only for tasks that should edit files.
- `bridge_status` now reports `defaultCwd` when the bridge has exactly one allowed root.
- ChatGPT can no longer request `danger-full-access` as a per-call `codex_run.sandbox` option; exposed options are `read-only` and `workspace-write`. The tool layer also rejects `danger-full-access` if the owner accidentally configures it as the bridge default.
- Write-enabled tool annotations now mark `codex_run`/`codex_reply` as potentially destructive because they can modify workspace files.
- ChatGPT UI smoke passed after refresh/restart when prompted to call `codex_run` with only `prompt`: response was `codex-gpt-bridge 0.1.0`.
- The first post-refresh ChatGPT UI attempt was blocked by OpenAI's tool safety layer because ChatGPT filled old-style `cwd`/`sandbox` arguments. The reliable daily template now says `只传 prompt`.

## Facts

- Local Codex CLI is `codex-cli 0.134.0`.
- `codex mcp-server` is available and exposes upstream tools `codex` and `codex-reply`.
- Bridge tools exposed over HTTP MCP: `bridge_status`, `codex_read`, `codex_run`, `codex_reply`, `codex_job_status`.
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
- Earlier pre-install shell checks did not have a Secure MCP Tunnel client available; this is now resolved by `/Users/linghao/.local/bin/tunnel-client`.
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
- `npm run check` passed on 2026-06-17 after adding Secure Tunnel no-auth doctor tolerance and OAuth probe JSON response: TypeScript build plus 22 Vitest tests.
- `npm run check` passed on 2026-06-17 after making `codex_run.cwd` optional for single-root bridge configs, adding the secure write-mode launcher, exposing `defaultCwd`, and rejecting ChatGPT-side `danger-full-access`: TypeScript build plus 28 Vitest tests.
- `npm run check` passed again on 2026-06-17 after updating README/setup prompt templates to the ChatGPT-verified `只传 prompt` form: TypeScript build plus 28 Vitest tests.
- `npm run bridge:chatgpt:secure:keychain` started successfully from Keychain. `tunnel-client doctor` still reports `oauth_metadata` failure for this No Auth server, but the launcher continues because `mcp_server_reachable` passes and the tunnel reaches the MCP server.
- macOS LaunchAgent `/Users/linghao/Library/LaunchAgents/com.linghao.codex-gpt-bridge.secure.plist` is loaded and running. `curl http://127.0.0.1:8876/healthz` returns `{"ok":true,"name":"codex-gpt-bridge"}`.
- ChatGPT UI Secure Tunnel smoke passed:
  - `@Local Codex Bridge Secure` called `bridge_status` and returned allowed root `/Users/linghao/Github/codex-gpt-bridge`, `read-only`, no write/danger permission, and upstream tools `codex,codex-reply`.
  - `@Local Codex Bridge Secure` called `codex_run` in `read-only` mode. Codex read `package.json`, returned package name `codex-gpt-bridge`, version `0.1.0`, script names, and reported no file modifications.

## Current Runtime

- Secure LaunchAgent is intentionally running and owns the local bridge on `127.0.0.1:8876`.
- `tunnel-client run --profile codex-gpt-bridge` is running under the LaunchAgent, forwarding the local MCP server through OpenAI Secure MCP Tunnel.
- Temporary Cloudflare quick tunnel has been stopped. The old Cloudflare URL should not be used.
- Default port `8765` returned `EADDRINUSE` during this test. `lsof` did not show a listener at the moment checked, so treat that as a transient or hidden-port state and prefer an explicit fallback port if it recurs.
- No Cloudflare tunnel process from the latest launcher smoke tests is intentionally left running.
- Chrome ChatGPT test conversation is open at `https://chatgpt.com/c/6a32f2af-036c-83ea-9343-ffda5e25cec1` with successful `bridge_status` and `codex_run` proof.

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
- `scripts/start-chatgpt-codex-bridge.mjs` now tolerates the expected `oauth_metadata` doctor failure for this No Auth Secure Tunnel setup when the MCP server reachability check passes.
- `scripts/start-secure-from-keychain.sh` starts secure mode by reading the tunnel id and runtime API key from macOS Keychain.
- `src/server.ts` returns JSON for OAuth protected-resource metadata probes in the No Auth tunnel setup.
- `package.json` added `bridge:chatgpt`, `bridge:chatgpt:local`, and `bridge:chatgpt:secure` scripts.
- `package.json` added `bridge:chatgpt:secure:keychain`.
- `package.json` added `bridge:chatgpt:secure:write:keychain`.
- `src/config.ts` and `src/tools.ts` now allow `codex_run` to omit `cwd` when exactly one allowed root is configured.
- `src/tools.ts` now reports `defaultCwd`, limits per-call sandbox options to `read-only`/`workspace-write`, rejects `danger-full-access`, and marks write-enabled tools as destructive.
- `test/tools.test.ts` covers default single-root `cwd` behavior, the multiple-root rejection path and error text, single-root/multi-root `defaultCwd`, and the rejection of ChatGPT-side `danger-full-access`.
- `README.md`, `docs/chatgpt-setup.md`, and `docs/security.md` now document shorter `只传 prompt` daily prompts, per-project roots, opt-in write mode, port differences, path replacement, and the no per-call danger boundary.
- `docs/chatgpt-setup.md`, `docs/security.md`, and `README.md` document the MCP setup, quick fallback, and Secure MCP Tunnel daily path.
- `TASK_STATE.md` updated with the current verification.

## Next Step

Daily use:

1. Ensure the LaunchAgent is running: `launchctl print gui/$(id -u)/com.linghao.codex-gpt-bridge.secure`.
2. In ChatGPT, use `@Local Codex Bridge Secure ...`.
3. Start with `bridge_status`; then use `codex_run` with `只传 prompt` when the bridge has one allowed root.
4. For another project, restart the bridge with `CODEX_GPT_BRIDGE_ROOT="/absolute/path/to/project"`.
5. For edits, use the write-mode launcher only on a narrow target repo.

## Cautions

- Do not put secrets in prompts or logs.
- Do not disable secret scanning unless the working directory is deliberately sanitized.
- Do not expose a no-auth endpoint outside localhost.
- Do not enable write mode until the read-only ChatGPT-side workflow is proven.
