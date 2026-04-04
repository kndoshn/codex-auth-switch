import { deriveManagedAuthPath } from "./account-record.js";
import { ensureDirectory, ensureDirectoryModeIfExists, ensureFileModeIfExists } from "./fs.js";
import { getAccountsDir, getConfigDir, getStatePath } from "./paths.js";

let permissionsPromise: Promise<void> | null = null;

export async function ensureManagedStoragePermissions(): Promise<void> {
  if (permissionsPromise) {
    await permissionsPromise;
    return;
  }

  permissionsPromise = ensureManagedStoragePermissionsUncached();

  try {
    await permissionsPromise;
  } catch (error) {
    permissionsPromise = null;
    throw error;
  }
}

export async function ensureManagedAuthFilePermissions(profileId: string): Promise<string> {
  const authPath = deriveManagedAuthPath(profileId);
  await ensureManagedStoragePermissions();
  await ensureFileModeIfExists(authPath, 0o600);
  return authPath;
}

async function ensureManagedStoragePermissionsUncached(): Promise<void> {
  const configDir = getConfigDir();
  const accountsDir = getAccountsDir();

  await ensureDirectory(configDir);
  await ensureDirectory(accountsDir);
  await ensureDirectoryModeIfExists(configDir, 0o700);
  await ensureDirectoryModeIfExists(accountsDir, 0o700);
  await ensureFileModeIfExists(getStatePath(), 0o600);
}
