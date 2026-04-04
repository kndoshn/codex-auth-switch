#!/usr/bin/env node

import { runCli } from "./cli.js";
import { reportCliFailure } from "./lib/command.js";

try {
  await runCli(process.argv.slice(2));
} catch (error) {
  process.exitCode = reportCliFailure({
    stderr: process.stderr,
    args: process.argv.slice(2),
    source: "bootstrap",
  }, error);
}
