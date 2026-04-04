import { Command } from "clipanion";

import { runCommand } from "../lib/command.js";

export class ListCommand extends Command {
  static paths = [["ls"]];

  static usage = Command.Usage({
    category: "Account",
    description: "List registered accounts.",
    examples: [["Show all accounts", "$0 ls"]],
  });

  async execute(): Promise<number> {
    return runCommand(this, async () => {
      const [{ formatAccountList }, { listAccounts }] = await Promise.all([
        import("../lib/format.js"),
        import("../services/account-service.js"),
      ]);
      const { accounts, currentProfileId } = await listAccounts();
      this.context.stdout.write(`${formatAccountList(accounts, currentProfileId)}\n`);
      return 0;
    });
  }
}
