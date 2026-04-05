import { afterEach, describe, expect, test, vi } from "vitest";

import { reportCliFailure, runCommand } from "../src/lib/command.js";
import { CodexAuthSwitchError } from "../src/lib/errors.js";

type MockCommand = {
  context: {
    stdout: {
      write: (chunk: string) => void;
    };
    stderr: {
      write: (chunk: string) => void;
    };
  };
};

describe("runCommand", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  test("prints only the display message for handled errors by default", async () => {
    const stdout = createBuffer();
    const stderr = createBuffer();
    const command = createMockCommand(stdout, stderr);

    const exitCode = await runCommand(command as never, async () => {
      throw new CodexAuthSwitchError("technical detail", {
        exitCode: 1,
        displayMessage: "Display message",
      });
    });

    expect(exitCode).toBe(1);
    expect(stderr.value).toBe("Display message\n");
  });

  test("emits a debug log for validation-style handled errors only in debug mode", async () => {
    vi.stubEnv("CODEX_AUTH_SWITCH_LOG_LEVEL", "debug");

    const stdout = createBuffer();
    const stderr = createBuffer();
    const command = createMockCommand(stdout, stderr);
    const processStderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const exitCode = await runCommand(command as never, async () => {
      throw new CodexAuthSwitchError("technical detail", {
        exitCode: 1,
        displayMessage: "Display message",
      });
    });

    expect(exitCode).toBe(1);
    const logOutput = processStderr.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(logOutput).toContain("\"event\":\"cli.failure.handled\"");
    expect(logOutput).toContain("\"level\":\"debug\"");
    expect(logOutput).toContain("\"displayMessage\":\"Display message\"");
    expect(stderr.value).toBe("Display message\n");
  });

  test("emits an error log for handled operational failures", async () => {
    const stdout = createBuffer();
    const stderr = createBuffer();
    const command = createMockCommand(stdout, stderr);
    const processStderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const exitCode = await runCommand(command as never, async () => {
      throw new CodexAuthSwitchError("state write failed", {
        exitCode: 2,
        displayMessage: "Failed to save state.",
      });
    });

    expect(exitCode).toBe(2);
    const logOutput = processStderr.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(logOutput).toContain("\"event\":\"cli.failure.handled\"");
    expect(logOutput).toContain("\"level\":\"error\"");
    expect(stderr.value).toBe("Failed to save state.\n");
  });

  test("emits an error log for unexpected failures", async () => {
    const stdout = createBuffer();
    const stderr = createBuffer();
    const command = createMockCommand(stdout, stderr);
    const processStderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const exitCode = await runCommand(command as never, async () => {
      throw new Error("boom");
    });

    expect(exitCode).toBe(2);
    const logOutput = processStderr.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(logOutput).toContain("\"event\":\"cli.failure.unexpected\"");
    expect(stderr.value).toBe("An unexpected error occurred.\n");
  });

  test("allows silent display messages when explicitly requested", () => {
    const stderr = createBuffer();
    const exitCode = reportCliFailure({
      stderr,
      args: ["usage"],
      source: "bootstrap",
    }, new CodexAuthSwitchError("silent failure", {
      exitCode: 2,
      displayMessage: "",
    }));

    expect(exitCode).toBe(2);
    expect(stderr.value).toBe("");
  });

  test("normalizes prompt aborts into a successful cancellation", async () => {
    const stdout = createBuffer();
    const stderr = createBuffer();
    const command = createMockCommand(stdout, stderr);

    const exitCode = await runCommand(command as never, async () => {
      const error = new Error("User force closed the prompt with SIGINT");
      error.name = "ExitPromptError";
      throw error;
    });

    expect(exitCode).toBe(0);
    expect(stdout.value).toBe("Canceled.\n");
    expect(stderr.value).toBe("");
  });

  test("does not treat a generic SIGINT failure as a prompt cancellation", async () => {
    const stdout = createBuffer();
    const stderr = createBuffer();
    const command = createMockCommand(stdout, stderr);

    const exitCode = await runCommand(command as never, async () => {
      throw new Error("Process exited with SIGINT");
    });

    expect(exitCode).toBe(2);
    expect(stdout.value).toBe("");
    expect(stderr.value).toBe("An unexpected error occurred.\n");
  });
});

function createMockCommand(
  stdout: { write: (chunk: string) => void },
  stderr: { write: (chunk: string) => void },
): MockCommand {
  return {
    context: {
      stdout,
      stderr,
    },
  };
}

function createBuffer(): { value: string; write: (chunk: string) => void } {
  return {
    value: "",
    write(chunk: string): void {
      this.value += chunk;
    },
  };
}
