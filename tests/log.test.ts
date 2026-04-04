import { afterEach, describe, expect, test, vi } from "vitest";

import {
  getConfiguredLogLevel,
  isDebugLoggingEnabled,
  logError,
  logDebug,
  logWarn,
  serializeError,
} from "../src/lib/log.js";
import { createLoadingIndicator } from "../src/lib/loading.js";

describe("log helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  test("falls back to error level for unknown values", () => {
    vi.stubEnv("CODEX_AUTH_SWITCH_LOG_LEVEL", "loud");

    expect(getConfiguredLogLevel()).toBe("error");
    expect(isDebugLoggingEnabled()).toBe(false);
  });

  test("enables debug logging only for debug level", () => {
    vi.stubEnv("CODEX_AUTH_SWITCH_LOG_LEVEL", "debug");
    expect(getConfiguredLogLevel()).toBe("debug");
    expect(isDebugLoggingEnabled()).toBe(true);

    vi.stubEnv("CODEX_AUTH_SWITCH_LOG_LEVEL", "warn");
    expect(isDebugLoggingEnabled()).toBe(false);
  });

  test("serializes nested causes and stack traces in debug mode", () => {
    vi.stubEnv("CODEX_AUTH_SWITCH_LOG_LEVEL", "debug");

    const rootCause = new Error("root cause");
    const error = new Error("top level", { cause: rootCause });
    const serialized = serializeError(error);

    expect(serialized).toMatchObject({
      name: "Error",
      message: "top level",
      cause: {
        name: "Error",
        message: "root cause",
      },
    });
    expect(serialized?.stack).toContain("top level");
  });

  test("redacts tokens from serialized error messages, stacks, and causes", () => {
    vi.stubEnv("CODEX_AUTH_SWITCH_LOG_LEVEL", "debug");

    const rootCause = new Error('{"access_token":"token-root","refresh_token":"refresh-root"}');
    const error = new Error("authorization: Bearer token-top", { cause: rootCause });
    error.stack = "Error: authorization: Bearer token-top\n    at session=secret-session";

    const serialized = serializeError(error);

    expect(JSON.stringify(serialized)).not.toContain("token-top");
    expect(JSON.stringify(serialized)).not.toContain("token-root");
    expect(JSON.stringify(serialized)).not.toContain("refresh-root");
    expect(JSON.stringify(serialized)).not.toContain("secret-session");
    expect(serialized?.message).toContain("[REDACTED]");
    expect(serialized?.stack).toContain("[REDACTED]");
    expect(serialized?.cause?.message).toContain("[REDACTED]");
  });

  test("writes sanitized structured logs", () => {
    vi.stubEnv("CODEX_AUTH_SWITCH_LOG_LEVEL", "warn");
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    logDebug("debug.event", "should be suppressed");
    logWarn("warn.event", "Something happened.", {
      error: new Error("boom"),
      accessToken: "token-123",
      nestedSecret: {
        rawAuthPayload: "{\"tokens\":{\"access_token\":\"token-123\"}}",
        authorization: "Bearer super-secret-token",
      },
      nested: {
        items: [1, true, new Error("nested boom")],
        callback: () => "ignored",
      },
    });

    expect(stderrWrite).toHaveBeenCalledTimes(1);

    const payload = JSON.parse(String(stderrWrite.mock.calls[0]?.[0] ?? ""));
    expect(payload).toMatchObject({
      pid: process.pid,
      level: "warn",
      event: "warn.event",
      message: "Something happened.",
      error: {
        name: "Error",
        message: "boom",
      },
      accessToken: "[REDACTED]",
      nestedSecret: "[REDACTED]",
      nested: {
        items: [
          1,
          true,
          {
            name: "Error",
            message: "nested boom",
          },
        ],
      },
    });
    expect(typeof payload.nested.callback).toBe("string");
    expect(JSON.stringify(payload)).not.toContain("super-secret-token");
    expect(JSON.stringify(payload)).not.toContain("token-123");
  });

  test("falls back to a safe placeholder when string sanitization fails", () => {
    vi.stubEnv("CODEX_AUTH_SWITCH_LOG_LEVEL", "warn");
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const replaceAllSpy = vi.spyOn(String.prototype, "replaceAll").mockImplementation(() => {
      throw new Error("sanitize failed");
    });

    logWarn("warn.event", "authorization: Bearer secret-token");

    const payload = JSON.parse(String(stderrWrite.mock.calls[0]?.[0] ?? ""));
    expect(payload.message).toBe("[REDACTION_FAILED]");

    replaceAllSpy.mockRestore();
  });

  test("clears active loading output before writing a log entry", () => {
    const stream = createStream(true);
    const loading = createLoadingIndicator(stream);
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    loading.start("Working");
    logError("error.event", "Something failed.");
    loading.stop();

    expect(stream.output).toContain("\r\x1B[2K");
    expect(stderrWrite).toHaveBeenCalledTimes(1);
  });
});

function createStream(isTTY: boolean): { isTTY: boolean; output: string; write: (chunk: string) => boolean } {
  return {
    isTTY,
    output: "",
    write(chunk: string): boolean {
      this.output += chunk;
      return true;
    },
  };
}
