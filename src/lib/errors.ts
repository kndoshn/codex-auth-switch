import type { UsageFailureCode } from "../types.js";

type CodexAuthSwitchErrorOptions = ErrorOptions & {
  exitCode?: number;
  displayMessage?: string;
};

export class CodexAuthSwitchError extends Error {
  readonly exitCode: number;
  readonly displayMessage: string;

  constructor(message: string, options: CodexAuthSwitchErrorOptions = {}) {
    super(message, options);
    this.name = new.target.name;
    this.exitCode = options.exitCode ?? 2;
    this.displayMessage = options.displayMessage ?? message;
  }
}

export class NotImplementedError extends CodexAuthSwitchError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, {
      ...options,
      exitCode: 2,
      displayMessage: "This feature is not implemented yet.",
    });
  }
}

export class InputValidationError extends CodexAuthSwitchError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, {
      ...options,
      exitCode: 1,
      displayMessage: "Please provide a valid email address.",
    });
  }
}

export class AccountNotFoundError extends CodexAuthSwitchError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, {
      ...options,
      exitCode: 1,
      displayMessage: "Account not found. Run `./codex-auth-switch ls` to see saved accounts.",
    });
  }
}

export class DuplicateAccountError extends CodexAuthSwitchError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, {
      ...options,
      exitCode: 1,
      displayMessage: "This account is already saved.",
    });
  }
}

export class NoAccountsError extends CodexAuthSwitchError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, {
      ...options,
      exitCode: 1,
      displayMessage: "No saved accounts yet. Run `./codex-auth-switch add <email>` first.",
    });
  }
}

export class NoCurrentAccountError extends CodexAuthSwitchError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, {
      ...options,
      exitCode: 1,
      displayMessage: "No active account label is selected. Run `./codex-auth-switch use <email>` first.",
    });
  }
}

export class CodexLoginFailedError extends CodexAuthSwitchError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, {
      ...options,
      exitCode: 3,
      displayMessage: "codex login failed.",
    });
  }
}

export class UnsupportedCredentialStoreError extends CodexAuthSwitchError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, {
      ...options,
      exitCode: 1,
      displayMessage:
        "This command currently requires file-based Codex auth storage. Set cli_auth_credentials_store = \"file\", or use auto with a readable auth.json.",
    });
  }
}

export class AuthReadError extends CodexAuthSwitchError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, {
      ...options,
      exitCode: 2,
      displayMessage: "Failed to read authentication data.",
    });
  }
}

export class AuthWriteError extends CodexAuthSwitchError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, {
      ...options,
      exitCode: 2,
      displayMessage: "Failed to write authentication data.",
    });
  }
}

export class CodexProcessRunningError extends CodexAuthSwitchError {
  constructor(
    message: string,
    options?: ErrorOptions & { detectedProcesses?: Array<{ pid: number; command: string }> },
  ) {
    const processes = options?.detectedProcesses ?? [];
    const lines = [
      "Cannot switch while Codex appears to be running.",
      "",
      ...formatDetectedProcesses(processes),
      "Close these sessions first, then retry.",
      "If you are running codex-auth-switch inside Codex, run it from another shell.",
    ];
    super(message, {
      ...options,
      exitCode: 1,
      displayMessage: lines.join("\n"),
    });
  }
}

function formatDetectedProcesses(
  processes: Array<{ pid: number; command: string }>,
): string[] {
  if (processes.length === 0) {
    return [];
  }

  const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);
  return [
    "Detected processes:",
    ...processes.map((p) => `  PID ${p.pid}: ${truncate(p.command, 80)}`),
    "",
  ];
}

export class ProcessInspectionError extends CodexAuthSwitchError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, {
      ...options,
      exitCode: 3,
      displayMessage: "Failed to inspect running processes.",
    });
  }
}

export class UsageFetchError extends CodexAuthSwitchError {
  readonly code: UsageFailureCode;

  constructor(code: UsageFailureCode, message: string, options?: ErrorOptions) {
    super(message, { ...options, exitCode: 3 });
    this.code = code;
  }
}

export class UsageAuthError extends UsageFetchError {
  constructor(
    code: Extract<UsageFailureCode, "auth_missing" | "auth_invalid" | "auth_mismatch">,
    message: string,
    options?: ErrorOptions,
  ) {
    super(code, message, options);
  }
}

export class StateCorruptionError extends CodexAuthSwitchError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, {
      ...options,
      exitCode: 2,
      displayMessage: "The state file is corrupted.",
    });
  }
}

export class StateReadError extends CodexAuthSwitchError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, {
      ...options,
      exitCode: 2,
      displayMessage: "Failed to read the state file.",
    });
  }
}

export class StateWriteError extends CodexAuthSwitchError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, {
      ...options,
      exitCode: 2,
      displayMessage: "Failed to write the state file.",
    });
  }
}

export class LockAcquisitionError extends CodexAuthSwitchError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, {
      ...options,
      exitCode: 2,
      displayMessage: "Another operation is already running.",
    });
  }
}
