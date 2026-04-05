import type { Command } from "clipanion";

import { CodexAuthSwitchError, PromptAbortedError } from "./errors.js";
import { logDebug, logError, serializeError } from "./log.js";

type Writer = {
  write: (chunk: string) => unknown;
};

type FailureReporterOptions = {
  stderr: Writer;
  stdout?: Writer;
  args: string[];
  source: "bootstrap" | "command";
  commandClass?: string;
};

export async function runCommand(
  command: Command,
  action: () => Promise<number>,
): Promise<number> {
  try {
    return await action();
  } catch (error) {
    return reportCliFailure({
      stderr: command.context.stderr,
      stdout: command.context.stdout,
      args: process.argv.slice(2),
      source: "command",
      commandClass: command.constructor.name,
    }, error);
  }
}

export function reportCliFailure(
  options: FailureReporterOptions,
  error: unknown,
): number {
  const handled = normalizeCliError(error);
  logCliFailure(options, handled, error);
  writeDisplayMessage(selectDisplayStream(options, handled), handled.displayMessage);
  return handled.exitCode;
}

export function normalizeCliError(error: unknown): CodexAuthSwitchError {
  if (isPromptAbortError(error)) {
    return new PromptAbortedError("Interactive prompt aborted.", {
      cause: error,
    });
  }

  if (error instanceof CodexAuthSwitchError) {
    return error;
  }

  if (error instanceof Error) {
    return new CodexAuthSwitchError(error.message, {
      cause: error,
      exitCode: 2,
      displayMessage: "An unexpected error occurred.",
    });
  }

  return new CodexAuthSwitchError("An unknown error occurred.", {
    exitCode: 2,
    displayMessage: "An unexpected error occurred.",
  });
}

function logCliFailure(
  options: FailureReporterOptions,
  handled: CodexAuthSwitchError,
  originalError: unknown,
): void {
  const context = {
    source: options.source,
    commandClass: options.commandClass,
    args: options.args,
    exitCode: handled.exitCode,
    displayMessage: handled.displayMessage,
    error: serializeError(originalError),
  };

  if (handled.exitCode === 0) {
    logDebug("cli.failure.handled", handled.message, context);
    return;
  }

  if (originalError instanceof CodexAuthSwitchError) {
    if (handled.exitCode <= 1) {
      logDebug("cli.failure.handled", handled.message, context);
      return;
    }

    logError("cli.failure.handled", handled.message, context);
    return;
  }

  logError("cli.failure.unexpected", handled.message, context);
}

function writeDisplayMessage(stream: Writer, displayMessage: string): void {
  if (displayMessage.trim().length === 0) {
    return;
  }

  stream.write(`${displayMessage}\n`);
}

function selectDisplayStream(
  options: FailureReporterOptions,
  handled: CodexAuthSwitchError,
): Writer {
  if (handled.exitCode === 0 && options.stdout) {
    return options.stdout;
  }

  return options.stderr;
}

function isPromptAbortError(error: unknown): error is Error {
  if (!(error instanceof Error)) {
    return false;
  }

  if (error.name === "ExitPromptError" || error.name === "AbortPromptError") {
    return true;
  }

  return /force closed the prompt|prompt was canceled/i.test(error.message);
}
