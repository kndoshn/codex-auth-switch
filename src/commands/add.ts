import { Command, Option } from "clipanion";

import { runCommand } from "../lib/command.js";
import { normalizeEmail } from "../lib/email.js";
import { createLoadingIndicator, runWithLoading } from "../lib/loading.js";

export class AddCommand extends Command {
  static paths = [["add"]];

  static usage = Command.Usage({
    category: "Account",
    description: "Register a Codex account under a user-supplied email label. The label is not verified against the sign-in session.",
    examples: [["Register an account", "$0 add foo@example.com"]],
  });

  email = Option.String({ required: true });

  async execute(): Promise<number> {
    return runCommand(this, async () => {
      const [{ formatAccountActionResult }, { addAccount }] = await Promise.all([
        import("../lib/format.js"),
        import("../services/account-service.js"),
      ]);
      const normalizedEmail = normalizeEmail(this.email);
      const loading = createLoadingIndicator(this.context.stderr);
      const account = await runWithLoading(loading, `Preparing sign-in for ${normalizedEmail}`, () =>
        addAccount(this.email, {
          onStageChange: (stage) => {
            updateAddLoading(stage, normalizedEmail, loading);
          },
        })
      );

      this.context.stdout.write(`${formatAccountActionResult("Added account", account)}\n`);
      return 0;
    });
  }
}

function updateAddLoading(
  stage: "validating_email" | "preparing_login" | "awaiting_login" | "saving_account",
  email: string,
  loading: ReturnType<typeof createLoadingIndicator>,
): void {
  if (stage === "validating_email") {
    loading.update(`Validating ${email}`);
    return;
  }

  if (stage === "preparing_login") {
    loading.update(`Preparing sign-in for ${email}`);
    return;
  }

  if (stage === "awaiting_login") {
    loading.freeze("Continue the login flow in the Codex CLI window");
    return;
  }

  loading.start(`Saving ${email}`);
}
