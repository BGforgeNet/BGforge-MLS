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
        // The files run in parallel, which more than halves the suite. This suite once drove the bundled
        // compiler across the whole corpus, and that compiler hangs on roughly one spawn in several
        // thousand, so serialising it kept the number of concurrent spawns down; since the oracles were
        // committed the sweeps compare against those in-process and only switch-differential.test.ts
        // still spawns it, a few dozen times in one file, which parallelism across files does not
        // multiply. The optimise differential retries a KILLED child for the same underlying reason.
        //
        // ~1500 gcc invocations plus the same number of in-process runs, against other suites running in
        // parallel on a contended runner. The timeout guards against hangs, not slowness.
        //
        // Both, at the same figure and for that same reason: the sweeps do their work in `beforeAll` and
        // assert over the result, so the hook is what runs long. Left at the default it expired under the
        // contention of the full gate while every test in the file reported green, and which shard it took
        // moved between runs - the shape of a starved hook rather than of anything the suite compiles.
        testTimeout: 600000,
        hookTimeout: 600000,
    },
});
