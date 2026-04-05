import { Builtins, Cli } from "clipanion";

import { AddCommand } from "./commands/add.js";
import { ListCommand } from "./commands/list.js";
import { RemoveCommand } from "./commands/remove.js";
import { UseCommand } from "./commands/use.js";
import { UsageCommand } from "./commands/usage.js";

const VERSION = "0.1.0";

export async function runCli(argv: string[]): Promise<void> {
  const cli = new Cli({
    binaryLabel: "codex-auth-switch",
    binaryName: "codex-auth-switch",
    binaryVersion: VERSION,
  });

  cli.register(AddCommand);
  cli.register(ListCommand);
  cli.register(RemoveCommand);
  cli.register(UseCommand);
  cli.register(UsageCommand);
  cli.register(Builtins.HelpCommand);
  cli.register(Builtins.VersionCommand);

  await cli.runExit(argv);
}
