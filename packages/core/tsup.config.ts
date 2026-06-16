import { defineConfig } from "tsup";

export default defineConfig([
  // Library + CLI for the monorepo / potential npm consumers.
  {
    entry: ["src/index.ts", "src/cli.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    outDir: "dist",
  },
  // Self-contained CLI bundled into the plugin: deps are inlined so the plugin
  // works after a bare install. `playwright` stays external — its Chromium
  // binary can't be bundled and is fetched by `narrate setup`.
  {
    entry: { narrate: "src/cli.ts" },
    format: ["esm"],
    outDir: "../plugin/bin",
    // Inline only the light deps; playwright (+ its transitive native bits)
    // stays external and is installed by `narrate setup`.
    noExternal: ["commander", "zod", "dotenv"],
    // commander is CJS and uses require(); define require under ESM so esbuild's
    // __require shim resolves node built-ins instead of throwing.
    banner: {
      js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
    },
    outExtension: () => ({ js: ".mjs" }),
    clean: false,
  },
]);
