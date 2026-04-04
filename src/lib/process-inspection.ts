export type PsEntry = {
  pid: number;
  command: string;
};

const WRAPPER_LAUNCHERS = new Set(["node", "bun", "bash", "zsh", "sh", "fish"]);

export function parsePsEntry(line: string): PsEntry | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^(\d+)\s+(.+)$/);
  if (!match) {
    return null;
  }

  return {
    pid: Number(match[1]),
    command: match[2] ?? "",
  };
}

export function findRunningCodexEntries(stdout: string, currentPid: number): PsEntry[] {
  return stdout
    .split("\n")
    .reduce<PsEntry[]>((matches, line) => {
      const entry = parsePsEntry(line);
      if (entry && entry.pid !== currentPid && isCodexCommand(entry.command)) {
        matches.push(entry);
      }
      return matches;
    }, []);
}

export function hasRunningCodexCommand(stdout: string, currentPid: number): boolean {
  return findRunningCodexEntries(stdout, currentPid).length > 0;
}

export function isCodexCommand(command: string): boolean {
  const tokens = tokenizeCommandLine(command);
  if (tokens.some((token) => isCodexToken(token))) {
    return true;
  }

  const launcher = tokens[0] ? getBasename(tokens[0]).toLowerCase() : "";
  if (!WRAPPER_LAUNCHERS.has(launcher)) {
    return false;
  }

  if (containsCodexShellPayload(tokens)) {
    return true;
  }

  return tokens.some((token, index) => index > 0 && looksLikeCodexWrapperToken(token));
}

export function tokenizeCommandLine(command: string): string[] {
  return command.match(/(?:'[^']*'|"[^"]*"|\S+)/g) ?? [];
}

export function isCodexToken(token: string): boolean {
  const basename = getBasename(token);
  return /^codex(?:\.(?:[cm]?js|ts|sh|cmd|exe|ps1))?$/i.test(basename);
}

export function looksLikeCodexWrapperToken(token: string): boolean {
  const normalized = stripWrappingQuotes(token);
  if (normalized.includes("/codex/") || normalized.endsWith("/codex")) {
    return true;
  }

  const basename = getBasename(token).toLowerCase();
  return basename === "codex" || basename === "codex.js" || basename === "codex.mjs" || basename === "codex.ts";
}

export function getBasename(token: string): string {
  const normalized = stripWrappingQuotes(token);
  return normalized.split("/").pop() ?? normalized;
}

function stripWrappingQuotes(token: string): string {
  return token.replace(/^['"]|['"]$/g, "");
}

function containsCodexShellPayload(tokens: readonly string[]): boolean {
  const shellCommandIndex = tokens.findIndex((token) => token === "-c");
  if (shellCommandIndex === -1) {
    return false;
  }

  const payload = tokens[shellCommandIndex + 1];
  if (!payload) {
    return false;
  }

  const nestedTokens = tokenizeCommandLine(stripWrappingQuotes(payload));
  return nestedTokens.some((token) => isCodexToken(token) || looksLikeCodexWrapperToken(token));
}
