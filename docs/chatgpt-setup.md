# ChatGPT setup

MCP means Model Context Protocol: ChatGPT calls tools exposed by an MCP server. This bridge is the MCP server ChatGPT talks to; local Codex remains the executor behind it.

## Short answer

Yes, this is an MCP app for ChatGPT.

The daily path is:

```text
ChatGPT UI -> OpenAI Secure MCP Tunnel -> Local Codex Bridge MCP -> local Codex MCP server -> Codex execution
```

Daily use after setup:

```text
@Local Codex Bridge Secure 调用 codex_read，只传 prompt：调查当前 project 顶层有哪些文件和目录，说明每个重要文件的用途；不要修改任何文件。
```

If the macOS LaunchAgent is installed, there is no terminal step. If you want to
run it manually instead:

```bash
cd /path/to/codex-gpt-bridge
npm run bridge:chatgpt:secure:keychain
```

Replace `/path/to/...` examples with your own absolute local paths.

The Keychain-backed launcher reads:

```text
codex-gpt-bridge:control-plane-api-key
codex-gpt-bridge:control-plane-tunnel-id
```

## Best long-term setup

Use OpenAI Secure MCP Tunnel. It keeps the local bridge private and lets ChatGPT call it through an OpenAI-hosted tunnel. This is the only clean setup where ChatGPT can keep the same app connection instead of changing a temporary Cloudflare URL.

One-time setup needs:

- `tunnel_id` from OpenAI Platform tunnel settings.
- `CONTROL_PLANE_API_KEY` with Tunnels Read + Use.
- `tunnel-client` installed locally.

Store the runtime values in macOS Keychain:

```bash
security add-generic-password -a "$USER" -s "codex-gpt-bridge:control-plane-api-key" -w "<runtime-api-key>" -U
security add-generic-password -a "$USER" -s "codex-gpt-bridge:control-plane-tunnel-id" -w "tunnel_..." -U
```

Run manually:

```bash
cd /path/to/codex-gpt-bridge
npm run bridge:chatgpt:secure:keychain
```

Or install a LaunchAgent that calls `scripts/start-secure-from-keychain.sh`.
The local service should report:

```bash
curl http://127.0.0.1:8876/healthz
```

The base bridge CLI defaults to port `8765`. The ChatGPT helper scripts use
`8876` to avoid clashing with local development runs.

In ChatGPT Settings -> Apps -> Create app:

- Connection: `Tunnel`
- Tunnel: choose/paste your `tunnel_...`
- Authentication: `No Auth`
- Click `Create`, then `Connect`

After connecting, `bridge_status` should show read-only policy and upstream
Codex tools `codex,codex-reply`.

## Prompt templates

Use the ChatGPT app mention every time:

```text
@Local Codex Bridge Secure ...
```

## Agent contract

后续 agent 必须按这个顺序调用，不要猜参数：

1. 先调 `bridge_status`，确认 `defaultCwd`、`defaultSandbox=read-only`、上游有 `codex,codex-reply`。
2. 只读调查一律调 `codex_read`，只传 `prompt`。不要传 `cwd`、`sandbox`，除非 `bridge_status` 显示多个 allowed roots。
3. 返回 `status=running` 时，复制完整 `jobId`，下一条 prompt 显式调用 `codex_job_status`。
4. 如果 ChatGPT 自动把上一次工具结果里的 `jobId` 继续传参被安全层拦截，不要反复要求“继续”。改成手动粘贴 exact `jobId`。
5. 只有明确需要修改文件时，才重启 write-mode bridge，并用 `codex_run`。
6. `codex_run` 的 prompt 要窄：只改指定文件/范围；不要让 Bridge 里的 Codex 同时编译、跑长命令或做大清理。
7. 编译、测试、渲染和最终 diff 检查由本地 Codex/terminal 做，再把结果交给 ChatGPT 复查。
8. 如果 ChatGPT 说没有 `codex_read`，去 Settings -> Apps -> Local Codex Bridge Secure -> Refresh，再新开 chat。
9. 如果出现 `502 Upstream or external service errors`，先检查是否还在用旧同步工具/schema；刷新 app，并确认本地 schema 里有 `codex_job_status`。

Status check:

```text
@Local Codex Bridge Secure 调用 bridge_status。只返回 allowedRoots、defaultCwd、defaultSandbox、allowWorkspaceWrite、allowDangerFullAccess、upstreamTools。
```

Ask Codex to inspect the current repo, then let ChatGPT answer:

```text
@Local Codex Bridge Secure 调用 codex_read，只传 prompt：调查当前 allowed root 的顶层文件和目录，说明每个重要文件的用途；不要修改任何文件。最后用简洁中文总结给我。如果返回 status=running 和 jobId，继续调用 codex_job_status 直到 completed 或 failed。
```

Poll a long-running job:

```text
@Local Codex Bridge Secure 调用 codex_job_status：jobId=<job id from codex_read or codex_run>
```

Continue after the first read/run returns a `threadId`:

```text
@Local Codex Bridge Secure 调用 codex_reply：
threadId=<thread id from previous codex_read or codex_run>
prompt=继续上一轮，只读检查 docs/chatgpt-setup.md 有没有让新用户困惑的地方；不要修改任何文件。
```

Useful local service checks:

```bash
launchctl print gui/$(id -u)/com.linghao.codex-gpt-bridge.secure
tail -n 80 ~/Library/Logs/codex-gpt-bridge-secure.log
tail -n 80 ~/Library/Logs/codex-gpt-bridge-secure.err.log
```

To use another repo, restart the secure bridge with that repo as the only
allowed root:

```bash
CODEX_GPT_BRIDGE_ROOT="/absolute/path/to/project" npm run bridge:chatgpt:secure:keychain
```

## Easy temporary setup

If Secure MCP Tunnel is not available on your account yet, use the one-command quick tunnel only as a temporary smoke test:

```bash
cd /path/to/codex-gpt-bridge
npm run bridge:chatgpt
```

It starts:

- local bridge on `127.0.0.1:8876`
- temporary Cloudflare HTTPS tunnel
- read-only Codex policy

Copy the printed `https://...trycloudflare.com/mcp` URL into ChatGPT:

- Settings -> Apps -> Local Codex Bridge Secure -> Manage
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

Only then call `codex_read` with a prompt. If the bridge has exactly one allowed
root, `cwd` is optional and defaults to that root:

```json
{
  "prompt": "Inspect this repository and summarize the test command. Do not edit files."
}
```

If multiple roots are configured, pass the absolute `cwd` explicitly.

If `codex_read` or `codex_run` returns `status=running`, ChatGPT should call
`codex_job_status` with the returned `jobId` until status is `completed` or
`failed`. This avoids Secure MCP Tunnel request timeouts for slower Codex runs.

Observed ChatGPT UI behavior: automatic chained polling can be blocked when
ChatGPT tries to reuse a `jobId` from a prior tool result. If that happens, send
one explicit follow-up:

```text
@Local Codex Bridge Secure 调用 codex_job_status，只传 jobId：<exact jobId>
```

This exact-jobId path is verified.

If `codex_read` or `codex_run` reports sensitive-looking files, move those files outside the allowed root or create a sanitized staging copy. Disabling the preflight is possible but should be treated as accepting that ChatGPT/Codex may read those local files.

Allowed roots only control which `cwd` values the bridge accepts. They are not a hard filesystem sandbox.

`codex_reply` only works for sessions created through the same running bridge process. Those records are in memory, capped at 1000 entries, and expire after 6 hours.

## Write mode

Write mode is intentionally off by default.

To allow workspace edits inside one target repo:

```bash
CODEX_GPT_BRIDGE_ROOT="/absolute/path/to/repo" npm run bridge:chatgpt:secure:write:keychain
```

Then ask ChatGPT to call Codex normally:

```text
@Local Codex Bridge Secure 调用 codex_run，只传 prompt：在当前 allowed root 内修改我的简历。先检查相关文件，说明计划，然后执行最小改动并运行可用检查。如果返回 status=running 和 jobId，继续调用 codex_job_status 直到 completed 或 failed。
```

For daily feedback loops, split planning, writing, and verification:

```text
@Local Codex Bridge Secure 调用 codex_read，只传 prompt：只读审查 <file>，给出最多 3 个必须修改的 blocker 和精确修改建议；不要修改文件。
```

```text
@Local Codex Bridge Secure 调用 codex_run，只传 prompt：只修改 <file>，按上一轮建议做最小改动；不要编译、不要运行 shell、不要改其他文件。完成后只总结改了什么。
```

Then compile or test locally outside the ChatGPT bridge. Send the updated file
back to ChatGPT only for review:

```text
@Local Codex Bridge Secure 调用 codex_read，只传 prompt：只读复查 <file> 是否还有 blocker；不要修改、不要编译、不要运行 shell。只输出 status: PASS/NEEDS_CHANGES、blockers、notes。
```

This bridge does not expose `danger-full-access` as a per-call ChatGPT option.
