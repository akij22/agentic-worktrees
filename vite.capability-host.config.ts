import { builtinModules } from "node:module";
import { defineConfig } from "vite";

const nodeBuiltins = [...builtinModules, ...builtinModules.map((name) => `node:${name}`)];

export default defineConfig({
  build: {
    target: "node22",
    outDir: ".vite/build",
    emptyOutDir: false,
    lib: {
      entry: "src/main/capabilities/host-entry.ts",
      formats: ["cjs"],
      fileName: () => "capability-host.js",
    },
    rollupOptions: {
      external: [
        ...nodeBuiltins,
        "better-sqlite3",
        "node-pty",
        "electron",
        "ajv",
        /^@modelcontextprotocol\/sdk(?:\/.*)?$/,
      ],
    },
  },
});
