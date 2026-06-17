import { mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { enforceSandbox, findSensitiveFiles, loadConfig, requireAllowedCwd } from "../src/config.js";

describe("config policy", () => {
  it("defaults to current directory as the only allowed root", () => {
    const config = loadConfig({
      CODEX_GPT_BRIDGE_NO_AUTH: "1"
    });

    expect(config.allowedRoots).toEqual([realpathSync(process.cwd())]);
    expect(config.defaultSandbox).toBe("read-only");
    expect(config.allowWorkspaceWrite).toBe(false);
  });

  it("requires token or explicit local no-auth", () => {
    expect(() =>
      loadConfig({
        CODEX_GPT_BRIDGE_HOST: "127.0.0.1"
      })
    ).toThrow(/TOKEN/);

    expect(() =>
      loadConfig({
        CODEX_GPT_BRIDGE_HOST: "0.0.0.0",
        CODEX_GPT_BRIDGE_NO_AUTH: "1"
      })
    ).toThrow(/NO_AUTH/);
  });

  it("rejects cwd outside allowed roots", () => {
    const root = mkdtempSync(path.join(tmpdir(), "bridge-root-"));
    const other = mkdtempSync(path.join(tmpdir(), "bridge-other-"));

    expect(requireAllowedCwd(root, [realpathSync(root)])).toBe(realpathSync(root));
    expect(() => requireAllowedCwd(other, [realpathSync(root)])).toThrow(/outside allowed roots/);
  });

  it("blocks write sandboxes unless explicitly enabled", () => {
    const config = loadConfig({
      CODEX_GPT_BRIDGE_NO_AUTH: "1"
    });

    expect(enforceSandbox(config, "read-only")).toBe("read-only");
    expect(() => enforceSandbox(config, "workspace-write")).toThrow(/ALLOW_WRITE/);
    expect(() => enforceSandbox(config, "danger-full-access")).toThrow(/ALLOW_DANGER/);
  });

  it("finds sensitive-looking files before delegation", () => {
    const root = mkdtempSync(path.join(tmpdir(), "bridge-root-"));
    writeFileSync(path.join(root, ".env"), "TOKEN=secret\n");
    writeFileSync(path.join(root, "server.pem"), "secret\n");

    expect(findSensitiveFiles(root)).toEqual([path.join(root, ".env"), path.join(root, "server.pem")]);
  });

  it("blocks sensitive-looking symlink names before delegation", () => {
    const root = mkdtempSync(path.join(tmpdir(), "bridge-root-"));
    const target = path.join(root, "target");
    writeFileSync(target, "TOKEN=secret\n");
    symlinkSync(target, path.join(root, ".env"));

    expect(findSensitiveFiles(root)).toEqual([path.join(root, ".env")]);
  });
});
