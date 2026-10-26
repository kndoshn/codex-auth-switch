import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Keep test output readable; tests that assert on logs set their own level.
    env: { CODEX_AUTH_SWITCH_LOG_LEVEL: "silent" },
    include: ["tests/**/*.test.ts"],
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "src/types.ts"],
    },
  },
});
