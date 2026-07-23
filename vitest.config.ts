import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // DB integration tests share one Postgres — don't run files in parallel.
    fileParallelism: false,
    setupFiles: ["dotenv/config"],
  },
});
