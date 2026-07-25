import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Mirror the `@/*` path alias from tsconfig, so a module under test imports the
  // same way the app does.
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // DB integration tests share one Postgres — don't run files in parallel.
    fileParallelism: false,
    setupFiles: ["dotenv/config"],
  },
});
