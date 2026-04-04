import { getConfiguredLogLevel } from "./log.js";
import { registerTransientOutput, unregisterTransientOutput } from "./transient-output.js";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const SPINNER_INTERVAL_MS = 80;

type TerminalStream = {
  isTTY?: boolean;
  write: (chunk: string) => boolean;
};

export type LoadingIndicator = {
  start: (message: string) => void;
  update: (message: string) => void;
  freeze: (message?: string) => void;
  stop: () => void;
};

export async function runWithLoading<T>(
  loading: LoadingIndicator,
  initialMessage: string,
  action: () => Promise<T>,
): Promise<T> {
  loading.start(initialMessage);

  try {
    return await action();
  } finally {
    loading.stop();
  }
}

export function createLoadingIndicator(stream: TerminalStream): LoadingIndicator {
  const enabled = isAnimationEnabled(stream);
  const supportsColor = enabled && process.env.NO_COLOR === undefined;

  let timer: NodeJS.Timeout | undefined;
  let frameIndex = 0;
  let running = false;
  let cursorHidden = false;
  let startedAt = 0;
  let message = "";

  function start(nextMessage: string): void {
    message = nextMessage;

    if (!enabled) {
      return;
    }

    if (running) {
      render();
      return;
    }

    running = true;
    startedAt = Date.now();
    frameIndex = 0;
    hideCursor();
    registerTransientOutput(clearLine);
    render();
    timer = setInterval(render, SPINNER_INTERVAL_MS);
    timer.unref?.();
  }

  function update(nextMessage: string): void {
    message = nextMessage;

    if (enabled && running) {
      render();
    }
  }

  function freeze(nextMessage?: string): void {
    stop();

    if (!enabled || !nextMessage) {
      return;
    }

    stream.write(`${paint("cyan", "•", supportsColor)} ${nextMessage}\n`);
  }

  function stop(): void {
    if (!enabled) {
      return;
    }

    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }

    if (!running) {
      return;
    }

    running = false;
    unregisterTransientOutput(clearLine);
    clearLine();
    showCursor();
  }

  function render(): void {
    if (!enabled || !running) {
      return;
    }

    const frame = SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length] ?? SPINNER_FRAMES[0];
    frameIndex += 1;
    const elapsed = formatElapsed(Date.now() - startedAt);

    stream.write(
      `\r\x1B[2K${paint("cyan", frame, supportsColor)} ${message}${paint("dim", ` · ${elapsed}`, supportsColor)}`,
    );
  }

  function hideCursor(): void {
    if (!enabled || cursorHidden) {
      return;
    }

    cursorHidden = true;
    stream.write("\x1B[?25l");
  }

  function showCursor(): void {
    if (!enabled || !cursorHidden) {
      return;
    }

    cursorHidden = false;
    stream.write("\x1B[?25h");
  }

  function clearLine(): void {
    if (!enabled) {
      return;
    }

    stream.write("\r\x1B[2K");
  }

  return {
    start,
    update,
    freeze,
    stop,
  };
}

function isAnimationEnabled(stream: TerminalStream): boolean {
  if (!stream.isTTY || process.env.TERM === "dumb") {
    return false;
  }

  const logLevel = getConfiguredLogLevel();
  return logLevel !== "debug" && logLevel !== "info" && logLevel !== "warn";
}

function formatElapsed(durationMs: number): string {
  if (durationMs < 1_000) {
    return `${Math.max(0.1, durationMs / 1_000).toFixed(1)}s`;
  }

  if (durationMs < 60_000) {
    return `${(durationMs / 1_000).toFixed(1)}s`;
  }

  const totalSeconds = Math.floor(durationMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function paint(color: "cyan" | "dim", text: string, enabled: boolean): string {
  if (!enabled) {
    return text;
  }

  if (color === "cyan") {
    return `\x1B[36m${text}\x1B[39m`;
  }

  return `\x1B[2m${text}\x1B[22m`;
}
