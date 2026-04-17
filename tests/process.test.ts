import { afterEach, describe, expect, test, vi } from "vitest";

const { execaMock } = vi.hoisted(() => ({
  execaMock: vi.fn(),
}));

vi.mock("execa", () => ({
  execa: execaMock,
}));

import {
  assertNoRunningCodexProcess,
  findRunningCodexProcesses,
} from "../src/lib/process.js";
import {
  CodexProcessRunningError,
  NotImplementedError,
  ProcessInspectionError,
} from "../src/lib/errors.js";

describe("process helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    execaMock.mockReset();
  });

  test("detects codex in direct and wrapper-style command lines but ignores the current process", async () => {
    execaMock.mockResolvedValue({
      stdout: [
        `${process.pid} /usr/local/bin/codex login`,
        "123 /usr/local/bin/node /tmp/codex.js login",
        "124 /usr/bin/bun /tmp/codex.ts login",
        "125 /bin/sh -c codex login",
        "126 /usr/local/bin/node /tmp/codex-auth-switch.js use",
        "127 /usr/bin/node /tmp/wrapper.js",
      ].join("\n"),
    });

    const entries = await findRunningCodexProcesses();
    expect(entries.length).toBeGreaterThan(0);
  });

  test("ignores unrelated commands", async () => {
    execaMock.mockResolvedValue({
      stdout: "123 codex-helper\n124 /usr/bin/node\n125 /usr/local/bin/codex-auth-switch use\n",
    });

    const entries = await findRunningCodexProcesses();
    expect(entries).toEqual([]);
  });

  test("throws a typed error with detected processes when a codex process is already running", async () => {
    execaMock.mockResolvedValue({
      stdout: "999 codex\n",
    });

    await expect(assertNoRunningCodexProcess()).rejects.toBeInstanceOf(
      CodexProcessRunningError,
    );
  });

  test("error displayMessage includes detected process info", async () => {
    execaMock.mockResolvedValue({
      stdout: "999 /Applications/Codex.app/Contents/MacOS/Codex\n",
    });

    try {
      await assertNoRunningCodexProcess();
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(CodexProcessRunningError);
      const err = error as CodexProcessRunningError;
      expect(err.displayMessage).toContain("==================== ERROR ====================");
      expect(err.displayMessage).toContain("Next steps:");
      expect(err.displayMessage).toContain("PID 999");
      expect(err.displayMessage).toContain("Codex.app");
    }
  });

  test("error displayMessage remains well-formed without detected process details", () => {
    const error = new CodexProcessRunningError("running");
    expect(error.displayMessage).toContain("==================== ERROR ====================");
    expect(error.displayMessage).not.toContain("Detected processes:");
    expect(error.displayMessage).toContain("Retry the command.");
  });

  test("not implemented errors use the shared user-facing message", () => {
    const error = new NotImplementedError("todo");
    expect(error.exitCode).toBe(2);
    expect(error.displayMessage).toBe("This feature is not implemented yet.");
  });

  test("wraps ps inspection failures in a typed error", async () => {
    execaMock.mockRejectedValue(new Error("ps failed"));

    await expect(findRunningCodexProcesses()).rejects.toBeInstanceOf(ProcessInspectionError);
  });
});
