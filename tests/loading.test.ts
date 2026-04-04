import { afterEach, describe, expect, test, vi } from "vitest";

import { createLoadingIndicator, runWithLoading } from "../src/lib/loading.js";

describe("loading indicator", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  test("renders animated frames on a tty stream", () => {
    vi.useFakeTimers();
    const stream = createStream(true);
    const loading = createLoadingIndicator(stream);

    loading.start("Fetching usage");
    vi.advanceTimersByTime(160);
    loading.update("Fetching usage · 1/3 complete");
    vi.advanceTimersByTime(80);
    loading.stop();

    expect(stream.output).toContain("\x1B[?25l");
    expect(stream.output).toContain("Fetching usage");
    expect(stream.output).toContain("1/3 complete");
    expect(stream.output).toContain("\x1B[?25h");
  });

  test("freezes into a plain line before interactive handoff", () => {
    vi.useFakeTimers();
    const stream = createStream(true);
    const loading = createLoadingIndicator(stream);

    loading.start("Preparing sign-in");
    loading.freeze("Continue the login flow in the Codex CLI window");

    expect(stream.output).toContain("Preparing sign-in");
    expect(stream.output).toContain("Continue the login flow in the Codex CLI window\n");
    expect(stream.output).toContain("\x1B[?25h");
  });

  test("freezing without a message only stops the spinner", () => {
    vi.useFakeTimers();
    const stream = createStream(true);
    const loading = createLoadingIndicator(stream);

    loading.start("Preparing sign-in");
    loading.freeze();

    expect(stream.output).toContain("Preparing sign-in");
    expect(stream.output).not.toContain("•");
    expect(stream.output).toContain("\x1B[?25h");
  });

  test("stays silent on non-tty streams", () => {
    const stream = createStream(false);
    const loading = createLoadingIndicator(stream);

    loading.start("Fetching usage");
    loading.update("Still fetching");
    loading.freeze("Paused");
    loading.stop();

    expect(stream.output).toBe("");
  });

  test("stays silent when verbose structured logging is enabled", () => {
    vi.stubEnv("CODEX_AUTH_SWITCH_LOG_LEVEL", "debug");
    const stream = createStream(true);
    const loading = createLoadingIndicator(stream);

    loading.start("Fetching usage");
    loading.update("Still fetching");
    loading.stop();

    expect(stream.output).toBe("");
  });

  test("disables animation on dumb terminals", () => {
    vi.stubEnv("TERM", "dumb");
    const stream = createStream(true);
    const loading = createLoadingIndicator(stream);

    loading.start("Fetching usage");
    loading.update("Still fetching");
    loading.stop();

    expect(stream.output).toBe("");
  });

  test("omits ANSI colors when NO_COLOR is set", () => {
    vi.useFakeTimers();
    vi.stubEnv("NO_COLOR", "1");
    const stream = createStream(true);
    const loading = createLoadingIndicator(stream);

    loading.start("Fetching usage");
    vi.advanceTimersByTime(80);
    loading.freeze("Ready");

    expect(stream.output).toContain("Ready\n");
    expect(stream.output).not.toContain("\x1B[36m");
    expect(stream.output).not.toContain("\x1B[2m");
  });

  test("does not hide the cursor twice when start is called again while running", () => {
    vi.useFakeTimers();
    const stream = createStream(true);
    const loading = createLoadingIndicator(stream);

    loading.start("First");
    loading.start("Second");
    loading.stop();

    expect(countOccurrences(stream.output, "\x1B[?25l")).toBe(1);
    expect(stream.output).toContain("Second");
  });

  test("formats long-running elapsed time in minutes", () => {
    vi.useFakeTimers();
    const stream = createStream(true);
    const loading = createLoadingIndicator(stream);

    loading.start("Fetching usage");
    vi.advanceTimersByTime(61_000);
    loading.update("Still fetching");
    loading.stop();

    expect(stream.output).toContain("1m 1s");
  });
});

describe("runWithLoading", () => {
  test("stops the indicator after a successful action", async () => {
    const loading = createLoadingMock();

    await expect(runWithLoading(loading, "Working", async () => "ok")).resolves.toBe("ok");

    expect(loading.start).toHaveBeenCalledWith("Working");
    expect(loading.stop).toHaveBeenCalledTimes(1);
  });

  test("stops the indicator when the action fails", async () => {
    const loading = createLoadingMock();

    await expect(
      runWithLoading(loading, "Working", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(loading.start).toHaveBeenCalledWith("Working");
    expect(loading.stop).toHaveBeenCalledTimes(1);
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

function createLoadingMock() {
  return {
    start: vi.fn(),
    update: vi.fn(),
    freeze: vi.fn(),
    stop: vi.fn(),
  };
}

function countOccurrences(text: string, pattern: string): number {
  return text.split(pattern).length - 1;
}
