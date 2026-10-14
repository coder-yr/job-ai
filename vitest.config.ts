// vitest.config.ts - maps workspace package names to their TypeScript sources
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: "@jobpilot/shared", replacement: r("./packages/shared/src/schemas.ts") },
      { find: "@jobpilot/db", replacement: r("./packages/db/src/client.ts") },
      { find: /^@jobpilot\/core\/(.*)$/, replacement: r("./packages/core/src/") + "$1" },
    ],
  },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
