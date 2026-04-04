import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export function getCodexAuthPath(): string {
  return getCodexAuthPathInHome(getActiveCodexHome());
}

export function getCodexAuthPathInHome(homeDir: string): string {
  return join(resolve(homeDir), "auth.json");
}

export function getCodexConfigPath(): string {
  return getCodexConfigPathInHome(getActiveCodexHome());
}

export function getCodexConfigPathInHome(homeDir: string): string {
  return join(resolve(homeDir), "config.toml");
}

export function getDefaultCodexHome(): string {
  return join(homedir(), ".codex");
}

export function getActiveCodexHome(): string {
  const configuredHome = process.env.CODEX_HOME;
  if (!configuredHome || configuredHome.trim().length === 0) {
    return getDefaultCodexHome();
  }

  return isAbsolute(configuredHome) ? configuredHome : resolve(process.cwd(), configuredHome);
}

export function getConfigDir(): string {
  return join(homedir(), ".config", "codex-auth-switch");
}

export function getAccountsDir(): string {
  return join(getConfigDir(), "accounts");
}

export function getAccountAuthPath(profileId: string): string {
  return join(getAccountsDir(), `${profileId}.json`);
}

export function getLockPath(): string {
  return join(getConfigDir(), "lock");
}

export function getStatePath(): string {
  return join(getConfigDir(), "state.json");
}
