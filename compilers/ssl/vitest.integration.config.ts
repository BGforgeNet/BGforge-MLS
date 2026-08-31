/**
 * Vitest configuration for the gcc differential over the real SSL corpus.
 *
 * Separated from vitest.config.ts because it needs the external repos cloned (scripts/test-external.sh
 * or pnpm test:external) and a gcc on PATH. Run with: pnpm --filter @bgforge/ssl test:integration
 */

import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        name: "ssl-integration",
        // Absolute so discovery works from the package directory and from the repo root alike.
        include: [path.resolve(import.meta.dirname, "test/integration/**/*.test.ts")],
        // Links the sfall headers into the corpus once for the whole project. Both suites need them,
        // and doing it per-file raced when the files ran in parallel.
        globalSetup: [path.resolve(import.meta.dirname, "test/integration/global-setup.ts")],
        // The files run in parallel (281s serial, 110s parallel). This suite once drove the bundled
        // compiler across the whole corpus, and that compiler hangs on roughly one spawn in several
        // thousand, so serialising it kept the number of concurrent spawns down; since the oracles were
        // committed the sweeps compare against those in-process and only switch-differential.test.ts
        // still spawns it, a few dozen times in one file, which parallelism across files does not
        // multiply. The optimise differential retries a KILLED child for the same underlying reason.
        //
        // ~1500 gcc invocations plus the same number of in-process runs, against other suites running in
        // parallel on a contended runner. The timeout guards against hangs, not slowness.
        testTimeout: 600000,
        hookTimeout: 60000,
    },
});
