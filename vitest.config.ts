import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    pool: "forks",
    // Each test file gets a fresh in-process Postgres so migration state is
    // deterministic and isolated (TESTING_STRATEGY.md).
    fileParallelism: true,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: "test",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // `server-only` is a guard package: in tests it must resolve to its
      // empty module (the react-server condition does this in Next.js).
      "server-only": path.resolve(__dirname, "node_modules/server-only/empty.js"),
    },
  },
});
