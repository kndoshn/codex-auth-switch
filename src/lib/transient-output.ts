let activeClearLine: (() => void) | null = null;

export function registerTransientOutput(clearLine: () => void): void {
  activeClearLine = clearLine;
}

export function unregisterTransientOutput(clearLine: () => void): void {
  if (activeClearLine === clearLine) {
    activeClearLine = null;
  }
}

export function flushTransientOutput(): void {
  activeClearLine?.();
}
