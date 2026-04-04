import { Command, Option } from "clipanion";

import { runCommand } from "../lib/command.js";
import { normalizeEmail } from "../lib/email.js";
import { NoAccountsError } from "../lib/errors.js";
import { createLoadingIndicator, runWithLoading } from "../lib/loading.js";

export class UseCommand extends Command {
  static paths = [["use"]];

  static usage = Command.Usage({
    category: "Account",
    description: "Switch the active Codex account.",
    examples: [
      ["Switch with interactive selection", "$0 use"],
      ["Switch directly", "$0 use foo@example.com"],
    ],
  });

  email = Option.String({ required: false });

  async execute(): Promise<number> {
    return runCommand(this, async () => {
      const [{ formatAccountActionResult }, { activateAccount }] = await Promise.all([
        import("../lib/format.js"),
        import("../services/account-service.js"),
      ]);
      const targetEmail = this.email ? normalizeEmail(this.email) : await promptForEmail();
      const loading = createLoadingIndicator(this.context.stderr);
      const account = await runWithLoading(loading, `Switching to ${targetEmail}`, () =>
        activateAccount(targetEmail, {
          onStageChange: (stage) => {
            loading.update(formatUseLoading(stage, targetEmail));
          },
        })
      );

      this.context.stdout.write(`${formatAccountActionResult("Active account", account)}\n`);
      return 0;
    });
  }
}

async function promptForEmail(): Promise<string> {
  const [{ listAccounts }, { select }] = await Promise.all([
    import("../services/account-service.js"),
    import("@inquirer/prompts"),
  ]);
  const { accounts } = await listAccounts();
  if (accounts.length === 0) {
    throw new NoAccountsError("No saved accounts are available for selection.");
  }

  return select({
    message: "Select an account",
    choices: accounts.map((account) => ({
      name: account.email,
      value: account.email,
      description: account.accountId,
    })),
  });
}

function formatUseLoading(
  stage: "checking_processes" | "loading_account" | "writing_auth" | "saving_state",
  email: string,
): string {
  if (stage === "checking_processes") {
    return "Checking for running Codex sessions";
  }

  if (stage === "loading_account") {
    return `Loading saved session for ${email}`;
  }

  if (stage === "writing_auth") {
    return `Updating the active Codex session for ${email}`;
  }

  return `Saving active account state for ${email}`;
}
