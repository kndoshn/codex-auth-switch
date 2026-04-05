import { confirm } from "@inquirer/prompts";
import { Command, Option } from "clipanion";

import { promptForSavedAccount } from "./account-prompt.js";
import { runCommand } from "../lib/command.js";
import { normalizeEmail } from "../lib/email.js";
import { createLoadingIndicator, runWithLoading } from "../lib/loading.js";
import type { AccountRecord } from "../types.js";

export class RemoveCommand extends Command {
  static paths = [["remove"]];

  static usage = Command.Usage({
    category: "Account",
    description: "Remove a saved Codex account.",
    examples: [
      ["Remove with interactive selection", "$0 remove"],
      ["Remove directly", "$0 remove foo@example.com"],
      ["Remove without confirmation", "$0 remove foo@example.com --yes"],
    ],
  });

  email = Option.String({ required: false });

  yes = Option.Boolean("--yes", false, {
    description: "Skip the confirmation prompt.",
  });

  async execute(): Promise<number> {
    return runCommand(this, async () => {
      const [{ formatAccountActionResult }, { getAccountByEmail, removeAccount }] = await Promise.all([
        import("../lib/format.js"),
        import("../services/account-service.js"),
      ]);

      const targetAccount = this.email
        ? await getAccountByEmail(normalizeEmail(this.email))
        : await promptForSavedAccount("Select an account to remove");

      if (!this.yes) {
        const confirmed = await confirmRemoval(targetAccount);
        if (!confirmed) {
          this.context.stdout.write("Canceled.\n");
          return 0;
        }
      }

      const loading = createLoadingIndicator(this.context.stderr);
      const removedAccount = await runWithLoading(loading, `Removing ${targetAccount.email}`, () =>
        removeAccount(targetAccount.email, {
          onStageChange: (stage) => {
            loading.update(formatRemoveLoading(stage, targetAccount.email));
          },
        })
      );

      this.context.stdout.write(`${formatAccountActionResult("Removed account", removedAccount)}\n`);
      return 0;
    });
  }
}

async function confirmRemoval(account: AccountRecord): Promise<boolean> {
  return confirm({
    message: `Remove ${account.email} (${account.accountId})?`,
    default: false,
  });
}

function formatRemoveLoading(stage: "loading_account" | "checking_processes" | "removing_auth" | "saving_state", email: string): string {
  if (stage === "loading_account") {
    return `Loading saved account for ${email}`;
  }

  if (stage === "checking_processes") {
    return "Checking for running Codex sessions";
  }

  if (stage === "removing_auth") {
    return `Removing saved auth for ${email}`;
  }

  return `Saving account state after removing ${email}`;
}
