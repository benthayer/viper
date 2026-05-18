import { defineConfig } from "vitest/config";

// Serial-only. viper tests share a single mongoose connection
// + a single MongoDB client across the whole run (see tests/lib/db.ts
// and tests/lib/getModelMongoose.ts). Parallel execution races the
// shared init and produces "connection not ready" / "Schema not
// registered" errors that look like real bugs but aren't. Don't be
// tempted to re-enable concurrency without re-architecting the harness
// to give each worker its own client + connection.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 15_000,
    hookTimeout: 15_000,
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
    fileParallelism: false,
    sequence: {
      concurrent: false,
    },
  },
});
