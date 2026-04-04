import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

import { getActiveCodexHome, getCodexAuthPath } from "../src/lib/paths.js";
import { withTempHome } from "./helpers/home.js";

describe("path helpers", () => {
  test("uses CODEX_HOME when it is set", async () => {
    await withTempHome(async (homeDir) => {
      const previousCodexHome = process.env.CODEX_HOME;
      process.env.CODEX_HOME = `${homeDir}/custom-home`;

      try {
        expect(getActiveCodexHome()).toBe(resolve(`${homeDir}/custom-home`));
        expect(getCodexAuthPath()).toBe(resolve(`${homeDir}/custom-home`, "auth.json"));
      } finally {
        if (previousCodexHome === undefined) {
          delete process.env.CODEX_HOME;
        } else {
          process.env.CODEX_HOME = previousCodexHome;
        }
      }
    });
  });

  test("resolves relative CODEX_HOME values", async () => {
    await withTempHome(async () => {
      const previousCodexHome = process.env.CODEX_HOME;
      process.env.CODEX_HOME = "relative-codex-home";

      try {
        expect(getActiveCodexHome()).toBe(resolve(process.cwd(), "relative-codex-home"));
        expect(getCodexAuthPath()).toBe(resolve(process.cwd(), "relative-codex-home", "auth.json"));
      } finally {
        if (previousCodexHome === undefined) {
          delete process.env.CODEX_HOME;
        } else {
          process.env.CODEX_HOME = previousCodexHome;
        }
      }
    });
  });
});
