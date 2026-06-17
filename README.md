# codex-gpt-bridge

Small MCP bridge project for both directions between ChatGPT/OpenAI models and local Codex.

Plain meaning:

- ChatGPT -> Codex: ChatGPT can act as the planner, while this local HTTP MCP server forwards only scoped execution requests to the official `codex mcp-server` running on your machine.
- Codex -> ChatGPT-like model: Codex can call a local stdio MCP server named `chatgpt`, which forwards explicit prompts to the official OpenAI Responses API.

Important boundary: the Codex -> model direction does not call the ChatGPT web UI or ChatGPT private product backend. It uses the official OpenAI API, so it needs `OPENAI_API_KEY` and API model access.

## Daily ChatGPT -> Codex use

Yes, this is MCP. ChatGPT sees `Local Codex Bridge Secure` as an app with five MCP tools:

- `bridge_status`
- `codex_read`
- `codex_run`
- `codex_reply`
- `codex_job_status`

### ChatGPT role: advisor and reviewer

Treat external ChatGPT as the top-level advisor, not as the local executor.
Its two best jobs are:

1. Before execution: inspect enough repo context through `codex_read`, then write the plan, risks, work order, and success checks.
2. After execution: act as an independent critical reviewer. It should read the changed files or diff through `codex_read` and return `PASS` or concrete blockers.

Local Codex is still responsible for execution: editing files, running tests,
compiling, rendering, inspecting diffs, and committing. Keep ChatGPT tool calls
narrow so it can reason well and so the bridge stays stable.

Advisor prompt:

```text
@Local Codex Bridge Secure 调用 codex_read，只传 prompt：你是这个项目的顶层 advisor。只读调查当前 allowed root，先列出和任务相关的 repo facts，然后给出整体方案、执行顺序、风险、验收标准，以及可以交给 Codex 执行的下一步指令；不要修改任何文件。
```

Reviewer prompt:

```text
@Local Codex Bridge Secure 调用 codex_read，只传 prompt：你是独立 critical reviewer。只读复查当前改动是否满足计划；不要修改、不要编译、不要运行 shell。只输出 status: PASS/NEEDS_CHANGES、blockers、evidence、next_instruction_for_codex。
```

Best daily path is OpenAI Secure MCP Tunnel. After the one-time setup, keep the
local daemon running with the Keychain-backed launcher:

```bash
cd /path/to/codex-gpt-bridge
npm run bridge:chatgpt:secure:keychain
```

Replace `/path/to/...` examples with your own absolute local paths.

If this is installed as a macOS LaunchAgent, there is no terminal step. Use
ChatGPT directly:

```text
@Local Codex Bridge Secure 调用 codex_read，只传 prompt：调查当前 project 顶层有哪些文件和目录，说明每个重要文件的用途；不要修改任何文件。
```

### Prompt templates

Usually you only need the app name and the task. If the bridge has exactly one
allowed root, `codex_read` uses that root automatically and always forces
Codex `read-only`. Use `codex_run` only when you intentionally start write mode.

### Fixed agent flow

Use this flow exactly. Do not guess tool names or pass extra arguments.

1. Confirm the app can reach the bridge:

```text
@Local Codex Bridge Secure 调用 bridge_status。只返回 allowedRoots、defaultCwd、defaultSandbox、allowWorkspaceWrite、allowDangerFullAccess、upstreamTools。
```

2. For read-only investigation, call `codex_read` and pass only `prompt`:

```text
@Local Codex Bridge Secure 调用 codex_read，只传 prompt：<your task>; 不要修改任何文件。
```

3. If the result contains `status=running`, copy the exact `jobId` and query it explicitly:

```text
@Local Codex Bridge Secure 调用 codex_job_status，只传 jobId：<exact jobId>
```

4. Use `codex_reply` only after a completed read/run returns a `threadId`.
5. Use `codex_run` only for intentional write-mode work, after restarting the bridge with a narrow `CODEX_GPT_BRIDGE_ROOT`.
6. If ChatGPT says automatic polling was blocked, do not retry the same vague instruction. Paste the exact `jobId`.
7. If ChatGPT cannot see `codex_read`, refresh the app in ChatGPT Settings -> Apps -> Local Codex Bridge Secure -> Refresh, then start a new chat.

Status check:

```text
@Local Codex Bridge Secure 调用 bridge_status。只返回 allowedRoots、defaultCwd、defaultSandbox、allowWorkspaceWrite、allowDangerFullAccess、upstreamTools。
```

Inspect files in a repo:

```text
@Local Codex Bridge Secure 调用 codex_read，只传 prompt：调查当前 allowed root 的顶层文件和目录，说明每个重要文件的用途；不要修改任何文件。如果返回 status=running 和 jobId，继续调用 codex_job_status 直到 completed 或 failed。
```

If `codex_read` or `codex_run` returns `status=running`, poll the job:

```text
@Local Codex Bridge Secure 调用 codex_job_status：jobId=<job id from codex_read or codex_run>
```

ChatGPT may block automatic chained polling when it tries to reuse a `jobId`
from the previous tool result by itself. If that happens, paste the exact
`jobId` into the next prompt as shown above; that path is verified.

Continue the same Codex thread after `codex_read` or `codex_run` returns a `threadId`:

```text
@Local Codex Bridge Secure 调用 codex_reply：
threadId=<thread id from previous codex_read or codex_run>
prompt=继续上一轮，只读检查 README.md 和 docs/chatgpt-setup.md 是否解释清楚日常用法；不要修改任何文件。
```

For a different project, restart the bridge with that repo as the only allowed
root:

```bash
CODEX_GPT_BRIDGE_ROOT="/absolute/path/to/project" npm run bridge:chatgpt:secure:keychain
```

For edits, keep the root narrow and start write mode only for the target repo:

```bash
CODEX_GPT_BRIDGE_ROOT="/absolute/path/to/project" npm run bridge:chatgpt:secure:write:keychain
```

Then in ChatGPT:

```text
@Local Codex Bridge Secure 调用 codex_run，只传 prompt：在当前 allowed root 内修改我的简历。先检查相关文件，说明计划，然后执行最小改动并运行可用检查。
```

For iterative review/edit loops, keep each tool call narrow:

1. `codex_read`: ask Codex to inspect the file and return a concrete edit plan.
2. `codex_run`: ask Codex to apply one narrow edit set. Do not ask it to compile, run long shell commands, or do broad cleanup inside the same bridge call.
3. Verify locally from Codex or your terminal: compile, render, run tests, and inspect the diff.
4. `codex_read`: send the updated file back through ChatGPT for review.
5. Repeat only if ChatGPT returns a real blocker.

Stable edit prompt:

```text
@Local Codex Bridge Secure 调用 codex_run，只传 prompt：只修改当前 allowed root 内的 <file>。按上一轮建议做最小改动；不要编译、不要运行 shell、不要改其他文件。完成后只总结改了什么。
```

Stable final review prompt:

```text
@Local Codex Bridge Secure 调用 codex_read，只传 prompt：只读复查 <file> 是否已经解决上一轮 blocker；不要修改、不要编译、不要运行 shell。只输出 status: PASS/NEEDS_CHANGES、blockers、notes。
```

One-time secure setup needs:

```bash
security add-generic-password -a "$USER" -s "codex-gpt-bridge:control-plane-api-key" -w "<runtime-api-key>" -U
security add-generic-password -a "$USER" -s "codex-gpt-bridge:control-plane-tunnel-id" -w "tunnel_..." -U
```

Then configure ChatGPT with Connection = `Tunnel`, the matching tunnel id, and
Authentication = `No Auth`.

The older Cloudflare quick tunnel path still exists for smoke tests, but it is
not the recommended daily workflow because the URL changes and can fail DNS.

## Why

Codex already ships a stdio MCP server with two useful tools:

- `codex`: start a local Codex session.
- `codex-reply`: continue a Codex session by thread id.

ChatGPT Apps/GPTs need an HTTP-accessible MCP endpoint. This project is the small missing adapter: HTTP MCP in, official Codex MCP out, with local safety policy in the middle.

For the other direction, Codex can already connect to stdio MCP servers. This project adds `codex-chatgpt-mcp`, a small MCP server exposing one tool, `ask_chatgpt`, backed by the OpenAI Responses API.

## Safety defaults

- Binds to `127.0.0.1` by default.
- Accepts `codex_read.cwd` and `codex_run.cwd` only under the configured roots. This is a bridge-level starting-directory gate, not OS-level file isolation.
- Uses Codex `read-only` sandbox by default.
- Requires either `CODEX_GPT_BRIDGE_TOKEN` or explicit local-only `CODEX_GPT_BRIDGE_NO_AUTH=1`.
- Does not expose raw shell, process control, full Codex app-server, or arbitrary Codex config.
- Blocks delegation when sensitive-looking files such as `.env`, private keys, or `.pem` files are present under the requested working directory.
- Allows `codex_reply` only for threads first created through this bridge, and reruns the sensitive-file preflight before continuing them.
- Blocks `workspace-write` unless `CODEX_GPT_BRIDGE_ALLOW_WRITE=1`.
- Does not expose `danger-full-access` as a per-call ChatGPT option.

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

## Codex -> ChatGPT-like model

Set an OpenAI API key first:

```bash
export OPENAI_API_KEY="<openai-api-key>"
export CODEX_CHATGPT_MODEL="gpt-5.5"
```

This repository includes a project-scoped Codex MCP config at `.codex/config.toml`:

```toml
[mcp_servers.chatgpt]
command = "npm"
args = ["run", "chatgpt:mcp"]
env_vars = ["OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_CHATGPT_MODEL", "CODEX_CHATGPT_TIMEOUT_MS"]
```

After opening a fresh Codex thread for this trusted project, Codex should have a `chatgpt` MCP server with one tool:

- `ask_chatgpt`: send an explicit prompt to the configured OpenAI API model and return text. Optional `reasoningEffort` values for the default `gpt-5.5` model are `none`, `low`, `medium`, `high`, and `xhigh`.

Manual smoke test without real API access:

```bash
npm run build
node dist/chatgpt-cli.js
```

The server runs over stdio and waits for MCP JSON-RPC messages. The automated test suite verifies tool registration and request shaping without calling the real API.

Prefer the project config above because `env_vars` forwards `OPENAI_API_KEY` from the running Codex environment without writing the secret into a config file. If you move this MCP config outside the project, add an absolute `cwd` that points to this repository before using `npm run chatgpt:mcp`.

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

When exposing a localhost server through an HTTPS tunnel, keep the bridge bound to
`127.0.0.1` and explicitly allow the tunnel host so the MCP SDK DNS-rebinding
protection accepts the forwarded `Host` header:

```bash
CODEX_GPT_BRIDGE_ALLOWED_HOSTS=127.0.0.1,localhost,your-tunnel.example.com \
CODEX_GPT_BRIDGE_NO_AUTH=1 \
CODEX_GPT_BRIDGE_ROOTS="/Users/me/project" \
npm run start
```

Use no-auth only for short-lived localhost/tunnel smoke tests. For durable use,
put OAuth or a trusted auth proxy in front of the bridge.

## ChatGPT connection

For ChatGPT Apps/GPTs, expose the local MCP endpoint with one of:

- OpenAI Secure MCP Tunnel.
- Cloudflare Tunnel.
- ngrok.

Then configure the ChatGPT app/connector MCP URL to the HTTPS `/mcp` endpoint. Keep the bridge bound to local host where possible and put the tunnel on top.

Built-in bearer-token auth is intended for local development, manual MCP clients, or a trusted proxy. Production ChatGPT Apps that require protected-tool auth should put an OAuth 2.1 / PKCE layer in front of this bridge; OAuth is not implemented in v0.1.

Observed ChatGPT Developer Mode flow:

1. Open ChatGPT Settings -> Apps -> Create app.
2. Use Server URL.
3. Set MCP Server URL to the tunnel HTTPS `/mcp` endpoint.
4. Set Authentication to No Auth for local smoke tests.
5. Accept the custom MCP server risk warning and create/connect the app.
6. In a chat, mention the app and ask it to call `bridge_status`, `codex_read`, `codex_run`, `codex_reply`, or `codex_job_status`.

## Tools exposed to ChatGPT

### `bridge_status`

Reports bridge policy, allowed roots, and upstream Codex MCP tool availability.

### `codex_read`

Starts a read-only Codex inspection in an allowed working directory. This is the
default daily tool for repo investigation and planning context.

It accepts the same `prompt`, optional `cwd`, and optional `timeoutMs` fields as
`codex_run`, but it does not accept a sandbox option. The bridge always forwards
`sandbox=read-only`.

Long reads use the same `status=running` + `jobId` flow as `codex_run`.

### `codex_run`

Starts a Codex session in an allowed working directory. Use this for write-mode
workflows; prefer `codex_read` for read-only investigation.

If Codex finishes quickly, the tool returns the Codex result directly. If Codex
runs longer than `CODEX_GPT_BRIDGE_FAST_RETURN_MS`, which defaults to 25 seconds,
the tool returns:

```json
{
  "status": "running",
  "jobId": "..."
}
```

Call `codex_job_status` with that `jobId` until the job is `completed` or
`failed`.

Required:

- `prompt`

Optional:

- `cwd`: defaults to the only configured allowed root; required when multiple roots are configured.
- `sandbox`: `read-only` by default; `workspace-write` appears only when the bridge owner starts write mode.
- `timeoutMs`

Approval policy is owner-controlled through `CODEX_GPT_BRIDGE_APPROVAL_POLICY`; callers cannot lower it per request.

Sensitive file preflight:

`codex_read` and `codex_run` refuse to start if they find common secret files under `cwd`, including `.env`, `.npmrc`, `.netrc`, private SSH key names, `.pem`, `.key`, `.p12`, and `.pfx` files. Disable only for a deliberately sanitized environment:

```bash
CODEX_GPT_BRIDGE_DISABLE_SECRET_SCAN=1 codex-gpt-bridge
```

### `codex_reply`

Continues a Codex session that was first created through this bridge.

Required:

- `threadId`
- `prompt`

The bridge rejects unknown thread ids and reruns the sensitive-file preflight against the original session directory before forwarding the reply.

Long replies use the same `status=running` + `jobId` flow as `codex_run`.

### `codex_job_status`

Checks a long-running `codex_read`, `codex_run`, or `codex_reply` job.

Required:

- `jobId`

Tracked sessions are in memory only, capped at 1000 entries, and expire after 6 hours. Restarting the bridge clears them.

## Development

```bash
npm run check
```

The tests use a fake upstream and do not call the real model.

## Existing project comparison

`riccilnl/colameta` is highly related and much broader: ChatGPT/GPTs to local executors, plan management, preview/apply, reports, and Git closure. It is alpha and its license text forbids commercial use, so this project does not copy its code.

`tuannvm/codex-mcp-server` is a mature Claude-to-Codex wrapper. It is useful prior art, but this project targets ChatGPT HTTP MCP and safety policy around the official Codex MCP server.
