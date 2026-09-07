import type { CodexCredentialStoreMode } from "../types.js";
import { extractAccountId } from "../lib/auth.js";
import { resolveCodexAuthSource } from "../lib/codex-auth-source.js";
import { readFileIfExists } from "../lib/fs.js";
import { getActiveCodexHome, getCodexAuthPath } from "../lib/paths.js";

export type AccountObservation = {
  status: "available" | "missing" | "invalid" | "unreadable";
  accountId: string | null;
  configuredMode: CodexCredentialStoreMode | null | "unknown";
};

// This is a read-only observation of the file, not the identity of a running client.
export async function observeAuthFile(): Promise<AccountObservation> {
  let configuredMode: AccountObservation["configuredMode"] = "unknown";
  try {
    configuredMode = (await resolveCodexAuthSource(getActiveCodexHome())).configuredMode;
  } catch {
    // Do not expose configuration contents or parser errors in diagnostics.
  }
  let raw: string | null;
  try {
    raw = await readFileIfExists(getCodexAuthPath());
  } catch {
    return { status: "unreadable", accountId: null, configuredMode };
  }
  if (raw === null) return { status: "missing", accountId: null, configuredMode };
  try {
    return { status: "available", accountId: extractAccountId(raw), configuredMode };
  } catch {
    // JSON errors can contain token-bearing input. Return only a safe status.
    return { status: "invalid", accountId: null, configuredMode };
  }
}
