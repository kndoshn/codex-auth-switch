import type { Command } from "clipanion";

import { CodexAuthSwitchError } from "./errors.js";
import { logDebug, logError, serializeError } from "./log.js";

type StderrWriter = {
  write: (chunk: string) => unknown;
};

type FailureReporterOptions = {
  stderr: StderrWriter;
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
  writeDisplayMessage(options.stderr, handled.displayMessage);
  return handled.exitCode;
}

export function normalizeCliError(error: unknown): CodexAuthSwitchError {
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

function writeDisplayMessage(stderr: StderrWriter, displayMessage: string): void {
  if (displayMessage.trim().length === 0) {
    return;
  }

  stderr.write(`${displayMessage}\n`);
}
