import { parse, type TomlTable } from "smol-toml";

import type { CodexCredentialStoreMode, ResolvedCodexCredentialStoreMode } from "../types.js";
import { readFileIfExists } from "./fs.js";
import { UnsupportedCredentialStoreError } from "./errors.js";
import { logDebug } from "./log.js";
import { getCodexAuthPathInHome, getCodexConfigPathInHome } from "./paths.js";

export type CodexAuthSourceInfo = {
  configuredMode: CodexCredentialStoreMode | null;
  resolvedMode: ResolvedCodexCredentialStoreMode;
  authPath: string;
  configPath: string;
  homeDir: string;
};

export async function resolveCodexAuthSource(homeDir: string): Promise<CodexAuthSourceInfo> {
  const configPath = getCodexConfigPathInHome(homeDir);
  const rawConfig = await readFileIfExists(configPath);
  let configuredMode: CodexCredentialStoreMode | null = null;
  if (rawConfig !== null) {
    let document: TomlTable;
    try {
      document = parse(rawConfig);
    } catch {
      // Parser errors can contain secret-bearing source lines. Never retain them.
      throw new UnsupportedCredentialStoreError(`Codex config is not valid TOML: ${configPath}`);
    }
    const value = document.cli_auth_credentials_store;
    if (value === "file" || value === "keyring" || value === "auto") {
      configuredMode = value;
    } else if (value !== undefined) {
      throw new UnsupportedCredentialStoreError(`Invalid cli_auth_credentials_store setting in ${configPath}.`);
    }
  }

  // A leftover auth.json does not prove that auto selected file storage.
  const resolvedMode: ResolvedCodexCredentialStoreMode =
    configuredMode === "file" || configuredMode === "keyring" ? configuredMode : "unresolved";
  const source = {
    configuredMode,
    resolvedMode,
    authPath: getCodexAuthPathInHome(homeDir),
    configPath,
    homeDir,
  };
  logDebug("auth.source.resolved", "Resolved Codex auth source.", source);
  return source;
}

export async function requireFileBasedCodexAuthSource(homeDir: string): Promise<CodexAuthSourceInfo> {
  const source = await resolveCodexAuthSource(homeDir);
  if (source.resolvedMode !== "file") {
    throw new UnsupportedCredentialStoreError(`Explicit file credential storage is required in ${source.configPath}.`);
  }
  return source;
}
