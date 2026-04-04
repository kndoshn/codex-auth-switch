import { Command, Option } from "clipanion";

import { runCommand } from "../lib/command.js";
import { normalizeEmail } from "../lib/email.js";
import { CodexAuthSwitchError, NoAccountsError } from "../lib/errors.js";
import { createLoadingIndicator, runWithLoading } from "../lib/loading.js";
import { allUsageResultsFailed } from "../lib/usage.js";
import type { UsageResult } from "../types.js";

export class UsageCommand extends Command {
  static paths = [["usage"]];

  static usage = Command.Usage({
    category: "Usage",
    description: "Show usage for the current account or all saved accounts.",
    examples: [
      ["Show current account usage", "$0 usage"],
      ["Show one account usage", "$0 usage foo@example.com"],
      ["Show all account usage", "$0 usage --all"],
      ["Show all account usage as JSON", "$0 usage --all --json"],
    ],
  });

  email = Option.String({ required: false });

  all = Option.Boolean("--all", false, {
    description: "Fetch usage for all registered accounts.",
  });

  json = Option.Boolean("--json", false, {
    description: "Print results as JSON.",
  });

  async execute(): Promise<number> {
    return runCommand(this, async () => {
      if (this.all && this.email) {
        throw new CodexAuthSwitchError("Cannot use an email argument together with --all.", {
          exitCode: 1,
          displayMessage: "Cannot use an email argument together with --all.",
        });
      }

      const loading = createLoadingIndicator(this.context.stderr);
      const results = this.all
        ? await getAllUsage(loading)
        : [await getSingleUsage(this.email, loading)];

      if (this.json) {
        this.context.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
        return allUsageResultsFailed(results) ? 3 : 0;
      }

      const { formatUsageResults } = await import("../lib/format.js");
      this.context.stdout.write(`${formatUsageResults(results)}\n`);
      return allUsageResultsFailed(results) ? 3 : 0;
    });
  }
}

async function getSingleUsage(
  email: string | undefined,
  loading: ReturnType<typeof createLoadingIndicator>,
): Promise<UsageResult> {
  const [{ getAccountByEmail, getCurrentAccount }, { fetchUsage }] = await Promise.all([
    import("../services/account-service.js"),
    import("../services/usage-service.js"),
  ]);
  const account = email
    ? await getAccountByEmail(normalizeEmail(email))
    : await getCurrentAccount();

  return runWithLoading(loading, `Fetching usage for ${account.email}`, () => fetchUsage(account));
}

async function getAllUsage(
  loading: ReturnType<typeof createLoadingIndicator>,
): Promise<UsageResult[]> {
  const [{ listAccounts }, { fetchUsageForAll }] = await Promise.all([
    import("../services/account-service.js"),
    import("../services/usage-service.js"),
  ]);
  const { accounts } = await listAccounts();
  if (accounts.length === 0) {
    throw new NoAccountsError("No saved accounts are available for usage lookup.");
  }

  return runWithLoading(loading, `Fetching usage for ${accounts.length} accounts`, () =>
    fetchUsageForAll(accounts, {
      onProgress: ({ total, completed, failed }) => {
        loading.update(formatUsageLoading(total, completed, failed));
      },
    })
  );
}

function formatUsageLoading(total: number, completed: number, failed: number): string {
  const segments = [
    `Fetching usage for ${total} accounts`,
    `${completed}/${total} complete`,
  ];

  if (failed > 0) {
    segments.push(`${failed} failed`);
  }

  return segments.join(" · ");
}
