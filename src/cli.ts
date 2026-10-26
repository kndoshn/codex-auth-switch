import { Builtins, Cli } from "clipanion";

import packageJson from "../package.json" with { type: "json" };

import { AddCommand } from "./commands/add.js";
import { ListCommand } from "./commands/list.js";
import { RemoveCommand } from "./commands/remove.js";
import { UseCommand } from "./commands/use.js";
import { UsageCommand } from "./commands/usage.js";

export async function runCli(argv: string[]): Promise<void> {
  const cli = new Cli({
    binaryLabel: "codex-auth-switch",
    binaryName: "codex-auth-switch",
    binaryVersion: packageJson.version,
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
