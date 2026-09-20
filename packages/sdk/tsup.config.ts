import { defineConfig } from "tsup";

/// ESM + CJS + type declarations for external consumers (bots, agents, market makers,
/// integrators — PROJECT_BRIEF.md Section 34). Workspace packages (`@alphamarkets/config`,
/// `@alphamarkets/types`) are shipped as TypeScript source inside this monorepo, so they are bundled
/// in; `viem` stays an external peer/dependency.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: { resolve: [/^@alphamarkets\//] },
  noExternal: [/^@alphamarkets\//],
  external: ["viem"],
  clean: true,
  sourcemap: true,
  target: "es2022",
});
