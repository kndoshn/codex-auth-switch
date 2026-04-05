import { NoAccountsError } from "../lib/errors.js";
import type { AccountRecord } from "../types.js";

export async function promptForSavedAccount(message: string): Promise<AccountRecord> {
  const [{ listAccounts }, { select }] = await Promise.all([
    import("../services/account-service.js"),
    import("@inquirer/prompts"),
  ]);
  const { accounts } = await listAccounts();
  if (accounts.length === 0) {
    throw new NoAccountsError("No saved accounts are available for selection.");
  }

  const selectedEmail = await select({
    message,
    choices: accounts.map((account) => ({
      name: account.email,
      value: account.email,
      description: account.accountId,
    })),
  });

  const account = accounts.find((entry) => entry.email === selectedEmail);
  if (!account) {
    throw new NoAccountsError("Selected account is no longer available.");
  }

  return account;
}
