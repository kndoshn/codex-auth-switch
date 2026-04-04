import { describe, expect, test } from "vitest";

import {
  getBasename,
  hasRunningCodexCommand,
  isCodexCommand,
  isCodexToken,
  looksLikeCodexWrapperToken,
  parsePsEntry,
  tokenizeCommandLine,
} from "../src/lib/process-inspection.js";

describe("process inspection helpers", () => {
  test("parsePsEntry returns null for empty or malformed lines", () => {
    expect(parsePsEntry("")).toBeNull();
    expect(parsePsEntry("not-a-ps-line")).toBeNull();
  });

  test("parsePsEntry extracts pid and command", () => {
    expect(parsePsEntry("123 /usr/local/bin/codex login")).toEqual({
      pid: 123,
      command: "/usr/local/bin/codex login",
    });
  });

  test("tokenizeCommandLine keeps quoted segments intact", () => {
    expect(tokenizeCommandLine("/bin/sh -c 'codex login --foo bar'")).toEqual([
      "/bin/sh",
      "-c",
      "'codex login --foo bar'",
    ]);
  });

  test("identifies codex tokens and wrapper tokens", () => {
    expect(isCodexToken("/usr/local/bin/codex")).toBe(true);
    expect(isCodexToken("\"/tmp/codex.ts\"")).toBe(true);
    expect(isCodexToken("codex-auth-switch")).toBe(false);

    expect(looksLikeCodexWrapperToken("/tmp/codex/index.js")).toBe(true);
    expect(looksLikeCodexWrapperToken("/tmp/codex-auth-switch.js")).toBe(false);
  });

  test("detects codex commands for direct, wrapper, and quoted launches", () => {
    expect(isCodexCommand("/usr/local/bin/codex login")).toBe(true);
    expect(isCodexCommand("/usr/bin/node /tmp/codex.mjs login")).toBe(true);
    expect(isCodexCommand("/bin/sh -c 'codex login'")).toBe(true);
    expect(isCodexCommand("/usr/bin/node /tmp/codex-auth-switch.js use")).toBe(false);
  });

  test("hasRunningCodexCommand ignores the current pid and unrelated entries", () => {
    const stdout = [
      "101 /usr/local/bin/codex login",
      "202 /usr/bin/node /tmp/codex.mjs login",
      "303 /usr/bin/node /tmp/codex-auth-switch.js use",
      "404 /usr/bin/python worker.py",
    ].join("\n");

    expect(hasRunningCodexCommand(stdout, 101)).toBe(true);
    expect(hasRunningCodexCommand(stdout, 202)).toBe(true);
    expect(hasRunningCodexCommand(stdout, 999)).toBe(true);
    expect(hasRunningCodexCommand("303 /usr/bin/node /tmp/codex-auth-switch.js use", 999)).toBe(false);
  });

  test("getBasename strips wrapping quotes", () => {
    expect(getBasename("\"/tmp/codex.ts\"")).toBe("codex.ts");
    expect(getBasename("'codex'")).toBe("codex");
  });
});
