import { defineConfig } from "tsdown";

export default defineConfig({
  entry: "src/index.ts",
  // bin-only package: nothing consumes type declarations.
  dts: false,
  clean: true,
  format: "esm",
  platform: "node",
  sourcemap: true,
});
