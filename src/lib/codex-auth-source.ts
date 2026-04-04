import { stat } from "node:fs/promises";

import type { CodexCredentialStoreMode, ResolvedCodexCredentialStoreMode } from "../types.js";
import { isFileNotFoundError, readFileIfExists } from "./fs.js";
import { UnsupportedCredentialStoreError } from "./errors.js";
import { logDebug } from "./log.js";
import { getCodexAuthPathInHome, getCodexConfigPathInHome } from "./paths.js";

export type CodexAuthSourceInfo = {
  configuredMode: CodexCredentialStoreMode;
  resolvedMode: ResolvedCodexCredentialStoreMode;
  authPath: string;
  configPath: string;
  homeDir: string;
};

const DEFAULT_CREDENTIAL_STORE_MODE: CodexCredentialStoreMode = "auto";

export async function resolveCodexAuthSource(homeDir: string): Promise<CodexAuthSourceInfo> {
  const configuredMode = await readConfiguredCredentialStoreMode(homeDir);
  const authPath = getCodexAuthPathInHome(homeDir);
  const configPath = getCodexConfigPathInHome(homeDir);

  let resolvedMode: ResolvedCodexCredentialStoreMode;
  if (configuredMode === "file") {
    resolvedMode = "file";
  } else if (configuredMode === "keyring") {
    resolvedMode = "keyring";
  } else {
    resolvedMode = await hasFileBackedAuth(authPath) ? "file" : "unresolved";
  }

  const source = {
    configuredMode,
    resolvedMode,
    authPath,
    configPath,
    homeDir,
  };

  logDebug("auth.source.resolved", "Resolved Codex auth source.", source);
  return source;
}

export async function requireFileBasedCodexAuthSource(homeDir: string): Promise<CodexAuthSourceInfo> {
  const source = await resolveCodexAuthSource(homeDir);
  if (source.resolvedMode === "file") {
    return source;
  }

  if (source.resolvedMode === "keyring") {
    throw new UnsupportedCredentialStoreError(
      `Codex is configured to use ${source.configuredMode} credential storage in ${source.homeDir}.`,
    );
  }

  throw new UnsupportedCredentialStoreError(
    `Codex credential storage could not be resolved to file mode in ${source.homeDir}.`,
  );
}

async function readConfiguredCredentialStoreMode(homeDir: string): Promise<CodexCredentialStoreMode> {
  const configPath = getCodexConfigPathInHome(homeDir);
  const rawConfig = await readFileIfExists(configPath);
  if (rawConfig === null) {
    return DEFAULT_CREDENTIAL_STORE_MODE;
  }

  const parsedMode = parseCredentialStoreMode(rawConfig);
  return parsedMode ?? DEFAULT_CREDENTIAL_STORE_MODE;
}

function parseCredentialStoreMode(rawConfig: string): CodexCredentialStoreMode | null {
  for (const line of rawConfig.split("\n")) {
    const withoutComment = line.replace(/#.*/, "").trim();
    if (!withoutComment.startsWith("cli_auth_credentials_store")) {
      continue;
    }

    const match = withoutComment.match(/^cli_auth_credentials_store\s*=\s*"([^"]+)"\s*$/);
    if (!match) {
      throw new UnsupportedCredentialStoreError(
        `Codex config contains an invalid cli_auth_credentials_store setting: ${withoutComment}.`,
      );
    }

    const value = match[1];
    if (value === "file" || value === "keyring" || value === "auto") {
      return value;
    }

    throw new UnsupportedCredentialStoreError(
      `Codex config contains an unsupported cli_auth_credentials_store value: ${value}.`,
    );
  }

  return null;
}

async function hasFileBackedAuth(authPath: string): Promise<boolean> {
  try {
    await stat(authPath);
    return true;
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return false;
    }

    return true;
  }
}
