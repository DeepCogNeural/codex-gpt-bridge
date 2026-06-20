# ChatGPT Pro Plugin vs Codex GPT Bridge

Decision as of 2026-06-20:

- For **Codex -> ChatGPT Pro website** use, prefer `pauljunsukhan/codex-chatgpt-pro-plugin` as the target line and likely companion tool.
- Do not treat it as the daily default until the install, packaging, and live proof gates below pass.
- Keep this repo, `codex-gpt-bridge`, as the primary **ChatGPT UI -> local Codex MCP** bridge.
- Do not replace one with the other. They solve opposite directions.

Human-readable comparison:

- `reports/chatgpt-pro-plugin-vs-codex-gpt-bridge-2026-06-20.html`
- Machine-readable manifest:
  `reports/chatgpt-pro-plugin-vs-codex-gpt-bridge-2026-06-20.json`

## Plain Difference

`codex-chatgpt-pro-plugin` is a Codex plugin plus CLI that drives a dedicated
logged-in ChatGPT Pro browser profile through Chrome DevTools Protocol. It does
not need `@chrome` because it launches and controls its own Chrome profile on
`127.0.0.1:9222`.

`codex-gpt-bridge` is an MCP bridge. Its strongest path is:

```text
ChatGPT UI -> OpenAI Secure MCP Tunnel -> Local Codex Bridge Secure -> local Codex MCP server -> Codex execution
```

Its current `Codex -> ChatGPT-like model` path is API-backed:

```text
Codex -> local stdio MCP server `chatgpt` -> OpenAI Responses API
```

That API path is useful, but it is not the ChatGPT Pro website.

## Recommended Fusion

1. Keep `Local Codex Bridge Secure` for ChatGPT directing local Codex.
2. Use `chatgpt-pro` as the Codex-to-ChatGPT advisor/reviewer line after it passes the readiness gate.
3. Borrow its room model, receipts, repo-context bundle, browser lock, and visible-history export ideas.
4. Fix or wrap its current Codex CLI install smoke issue and materialized package `init` path issue before calling it fully production-ready.
5. Do not fold browser automation into this MCP bridge until the direct plugin line is boringly reliable.

## Readiness Gate

Before making `chatgpt-pro` the daily default:

1. Fix or wrap the current Codex CLI install smoke issue where
   `plugin marketplace add ... --json` is rejected.
2. Fix the materialized package `init` path so installed package execution can
   find `skills/chatgpt-pro-line/SKILL.md` without relying on a missing
   `.codex/skills/...` path.
3. Run live proof in the dedicated ChatGPT browser: `doctor --warm`, manual
   login if needed, `doctor --live`, one `main` advisor call, and one
   `critic --fresh` reviewer call, each with receipts.
4. Keep explicit `--upload-file` artifacts narrow and pre-scrubbed.

Until those pass, fallback is this repo's API-backed `ask_chatgpt` for simple
model calls, or manual ChatGPT use for website-only Pro reasoning.

## Daily Shape After Readiness

From Codex, call ChatGPT Pro for high-level thinking:

```bash
chatgpt-pro call \
  --alias=main \
  --repo-context=auto \
  --confirm-repo-context-upload \
  --prompt="你是本 repo 的顶层 advisor。请审查架构、指出最大风险，并给 Codex 一个最小下一步。"
```

Then Codex executes locally. After the diff/tests exist, call ChatGPT Pro again
as reviewer:

```bash
chatgpt-pro call \
  --alias=critic \
  --fresh \
  --upload-file=diff.patch \
  --upload-file=test-output.txt \
  --prompt="你是独立 critical reviewer。只判断这个 diff 是否达标。输出 PASS 或 NEEDS_CHANGES。"
```

Use `Local Codex Bridge Secure` only when the starting point is ChatGPT UI and
ChatGPT needs to inspect or direct local Codex.

Do not treat explicit `--upload-file` files as automatically scrubbed. Review or
generate a narrow artifact before uploading sensitive repos.
