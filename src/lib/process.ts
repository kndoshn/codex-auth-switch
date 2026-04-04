import { execa } from "execa";

import { CodexProcessRunningError, ProcessInspectionError } from "./errors.js";
import { logDebug, logWarn } from "./log.js";
import type { PsEntry } from "./process-inspection.js";
import { findRunningCodexEntries } from "./process-inspection.js";

export async function assertNoRunningCodexProcess(): Promise<void> {
  const entries = await findRunningCodexProcesses();
  if (entries.length > 0) {
    logWarn("process.inspect.running", "Detected running codex processes.", { entries });
    throw new CodexProcessRunningError(
      "A codex process is already running.",
      { detectedProcesses: entries },
    );
  }
}

export async function findRunningCodexProcesses(): Promise<PsEntry[]> {
  let stdout: string;
  logDebug("process.inspect.start", "Inspecting running processes for codex.", {
    currentPid: process.pid,
  });

  try {
    const result = await execa("ps", ["-A", "-o", "pid=,args="], {
      reject: false,
    });
    stdout = result.stdout;
  } catch (error) {
    logWarn("process.inspect.failure", "Failed to inspect running processes.", {
      error,
    });
    throw new ProcessInspectionError("Failed to inspect running processes.", {
      cause: error,
    });
  }

  const entries = findRunningCodexEntries(stdout, process.pid);

  logDebug("process.inspect.result", "Finished inspecting running processes.", {
    running: entries.length > 0,
  });
  return entries;
}
