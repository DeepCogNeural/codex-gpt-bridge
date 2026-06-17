#!/usr/bin/env node
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

const args = parseArgs(process.argv.slice(2));
const mode = args.mode || process.env.CODEX_GPT_BRIDGE_MODE || "quick";
const root = resolve(args.root || process.cwd());
const port = String(args.port || process.env.CODEX_GPT_BRIDGE_PORT || "8876");
const host = "127.0.0.1";
const localOriginUrl = `http://${host}:${port}`;
const localMcpUrl = `${localOriginUrl}/mcp`;
const children = new Set();

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  cleanup(1);
});

async function main() {
  if (args.help) {
    printHelp();
    return;
  }

  ensureBuilt();

  if (mode === "local") {
    startBridge({ allowedHosts: ["127.0.0.1", "localhost"] });
    await waitForHealth(`${localOriginUrl}/healthz`);
    printLocalInstructions();
    await waitForever();
    return;
  }

  if (mode === "quick") {
    await startQuickTunnel();
    return;
  }

  if (mode === "secure") {
    await startSecureTunnel();
    return;
  }

  throw new Error(`Unknown mode: ${mode}`);
}

function ensureBuilt() {
  if (args.noBuild) {
    return;
  }
  const packageJson = resolve(repoRoot, "package.json");
  if (!existsSync(packageJson)) {
    return;
  }
  const result = spawnSync("npm", ["run", "build"], {
    cwd: repoRoot,
    stdio: "inherit"
  });
  if (result.status !== 0) {
    throw new Error("Build failed. Run npm run build manually for details.");
  }
}

async function startQuickTunnel() {
  const maxAttempts = Number(args.quickAttempts || process.env.CODEX_GPT_BRIDGE_QUICK_ATTEMPTS || "3");
  if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
    throw new Error("--quick-attempts must be a positive integer.");
  }
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    console.log(`Starting Cloudflare quick tunnel${maxAttempts > 1 ? ` (attempt ${attempt}/${maxAttempts})` : ""}...`);
    const tunnel = spawnChild("npx", ["-y", "cloudflared", "tunnel", "--url", localOriginUrl], {
      cwd: repoRoot
    });
    let bridge;

    try {
      const tunnelUrl = await waitForTunnelUrl(tunnel);
      const tunnelHost = new URL(tunnelUrl).host;
      bridge = startBridge({ allowedHosts: ["127.0.0.1", "localhost", tunnelHost] });

      await waitForHealth(`${localOriginUrl}/healthz`);
      await waitForHealth(`${tunnelUrl}/healthz`);

      console.log("");
      console.log("ChatGPT MCP URL:");
      console.log(`${tunnelUrl}/mcp`);
      console.log("");
      console.log("Use in ChatGPT:");
      console.log("1. Settings -> Apps -> Local Codex Bridge -> Manage");
      console.log("2. Set Server URL to the MCP URL above, Authentication = No Auth, then Refresh");
      console.log("3. In a chat: @Local Codex Bridge 调用 bridge_status");
      console.log("");
      console.log("This quick tunnel is temporary. Press Ctrl-C here to close the public endpoint.");

      await waitForever();
      return;
    } catch (error) {
      lastError = error;
      console.error(`Quick tunnel attempt ${attempt} failed: ${error instanceof Error ? error.message : String(error)}`);
      stopChild(bridge);
      stopChild(tunnel);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
    }
  }

  throw lastError || new Error("Cloudflare quick tunnel failed.");
}

async function startSecureTunnel() {
  const tunnelId = args.tunnelId || process.env.CONTROL_PLANE_TUNNEL_ID;
  if (!tunnelId) {
    throw new Error("Secure mode needs --tunnel-id or CONTROL_PLANE_TUNNEL_ID.");
  }
  if (!process.env.CONTROL_PLANE_API_KEY && !process.env.OPENAI_API_KEY) {
    throw new Error("Secure mode needs CONTROL_PLANE_API_KEY or OPENAI_API_KEY in the environment.");
  }
  const tunnelClient = args.tunnelClient || process.env.TUNNEL_CLIENT || defaultTunnelClient();
  const profile = args.profile || process.env.TUNNEL_CLIENT_PROFILE || "codex-gpt-bridge";

  startBridge({ allowedHosts: ["127.0.0.1", "localhost"] });
  await waitForHealth(`${localOriginUrl}/healthz`);

  const init = spawnSync(
    tunnelClient,
    [
      "init",
      "--sample",
      "sample_mcp_remote_no_auth",
      "--profile",
      profile,
      "--tunnel-id",
      tunnelId,
      "--mcp-server-url",
      localMcpUrl,
      "--force",
      "--health-listen-addr",
      "127.0.0.1:0"
    ],
    { cwd: repoRoot, stdio: "inherit" }
  );
  if (init.status !== 0) {
    throw new Error("tunnel-client init failed.");
  }

  console.log("Running tunnel-client doctor...");
  const doctor = spawnSync(tunnelClient, ["doctor", "--profile", profile, "--explain"], {
    cwd: repoRoot,
    stdio: "inherit"
  });
  if (doctor.status !== 0) {
    throw new Error("tunnel-client doctor failed. Fix the tunnel/API key setup first.");
  }

  console.log("Starting Secure MCP Tunnel...");
  spawnChild(tunnelClient, ["run", "--profile", profile], { cwd: repoRoot });

  console.log("");
  console.log("Use in ChatGPT:");
  console.log("1. Settings -> Apps -> Local Codex Bridge -> Manage");
  console.log(`2. Connection = Tunnel, select/paste tunnel id: ${tunnelId}`);
  console.log("3. Authentication = No Auth, then Refresh");
  console.log("4. In a chat: @Local Codex Bridge 调用 bridge_status");
  console.log("");
  console.log("Keep this process running while ChatGPT uses local Codex.");

  await waitForever();
}

function startBridge({ allowedHosts }) {
  const env = {
    ...process.env,
    CODEX_GPT_BRIDGE_HOST: host,
    CODEX_GPT_BRIDGE_PORT: port,
    CODEX_GPT_BRIDGE_NO_AUTH: "1",
    CODEX_GPT_BRIDGE_ROOTS: root,
    CODEX_GPT_BRIDGE_ALLOWED_HOSTS: allowedHosts.join(",")
  };
  if (args.write) {
    env.CODEX_GPT_BRIDGE_ALLOW_WRITE = "1";
    env.CODEX_GPT_BRIDGE_DEFAULT_SANDBOX = "workspace-write";
  } else {
    env.CODEX_GPT_BRIDGE_DEFAULT_SANDBOX = "read-only";
  }
  return spawnChild("node", [resolve(repoRoot, "dist/cli.js")], { cwd: repoRoot, env });
}

function spawnChild(command, childArgs, options = {}) {
  const child = spawn(command, childArgs, {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  children.add(child);
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (code && !shuttingDown) {
      console.error(`${command} exited with code ${code}${signal ? ` (${signal})` : ""}`);
      cleanup(code);
    }
  });
  return child;
}

function stopChild(child) {
  if (!child || child.killed) {
    return;
  }
  child.kill("SIGINT");
}

function waitForTunnelUrl(child) {
  return new Promise((resolveUrl, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for Cloudflare tunnel URL."));
    }, 45_000);
    const onData = (chunk) => {
      const text = chunk.toString();
      const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (match) {
        clearTimeout(timeout);
        child.stdout.off("data", onData);
        child.stderr.off("data", onData);
        resolveUrl(match[0]);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
  });
}

async function waitForHealth(url) {
  const started = Date.now();
  let lastFailure = "no response yet";
  while (Date.now() - started < 90_000) {
    const curlResult = spawnSync("curl", ["-fsS", "--max-time", "10", url], {
      encoding: "utf8"
    });
    if (curlResult.status === 0) {
      return;
    }
    lastFailure =
      curlResult.stderr?.trim() ||
      curlResult.stdout?.trim() ||
      `curl exited with status ${curlResult.status ?? "unknown"}`;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  throw new Error(`Timed out waiting for ${url}. Last failure: ${lastFailure}`);
}

function printLocalInstructions() {
  console.log("");
  console.log(`Local MCP endpoint: ${localMcpUrl}`);
  console.log("This is local-only. ChatGPT web cannot call it without Tunnel or HTTPS.");
  console.log("Press Ctrl-C to stop.");
}

function printHelp() {
  console.log(`Usage:
  npm run bridge:chatgpt
  npm run bridge:chatgpt -- --mode quick --root /absolute/repo
  npm run bridge:chatgpt -- --mode secure --tunnel-id tunnel_...
  npm run bridge:chatgpt:local

Modes:
  quick   Start local bridge + temporary Cloudflare HTTPS tunnel.
  secure  Start local bridge + OpenAI Secure MCP Tunnel using tunnel-client.
  local   Start local bridge only.

Options:
  --root <path>          Allowed repo root. Defaults to current directory.
  --port <port>          Local bridge port. Defaults to 8876.
  --write                Enable workspace-write instead of read-only.
  --tunnel-id <id>       OpenAI Secure MCP Tunnel id for secure mode.
  --profile <name>       tunnel-client profile name. Defaults to codex-gpt-bridge.
  --tunnel-client <path> tunnel-client binary. Defaults to ~/.local/bin/tunnel-client when present, otherwise PATH.
  --quick-attempts <n>   Cloudflare quick tunnel retry count. Defaults to 3.
  --no-build             Skip npm run build check.
`);
}

function defaultTunnelClient() {
  const localBinary = resolve(homedir(), ".local/bin/tunnel-client");
  return existsSync(localBinary) ? localBinary : "tunnel-client";
}

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--no-build") parsed.noBuild = true;
    else if (arg === "--write") parsed.write = true;
    else if (arg === "--mode") parsed.mode = rawArgs[++index];
    else if (arg === "--root") parsed.root = rawArgs[++index];
    else if (arg === "--port") parsed.port = rawArgs[++index];
    else if (arg === "--tunnel-id") parsed.tunnelId = rawArgs[++index];
    else if (arg === "--profile") parsed.profile = rawArgs[++index];
    else if (arg === "--tunnel-client") parsed.tunnelClient = rawArgs[++index];
    else if (arg === "--quick-attempts") parsed.quickAttempts = rawArgs[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

let shuttingDown = false;
function cleanup(code = 0) {
  shuttingDown = true;
  for (const child of children) {
    child.kill("SIGINT");
  }
  setTimeout(() => process.exit(code), 200).unref();
}

function waitForever() {
  return new Promise(() => {});
}

process.on("SIGINT", () => cleanup(0));
process.on("SIGTERM", () => cleanup(0));
