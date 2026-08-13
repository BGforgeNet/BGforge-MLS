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
        include: [path.resolve(__dirname, "test/integration/**/*.test.ts")],
        // Links the sfall headers into the corpus once for the whole project. Both suites need them,
        // and doing it per-file raced when the files ran in parallel.
        globalSetup: [path.resolve(__dirname, "test/integration/global-setup.ts")],
        // The corpus differential once obtained 1516 oracles inside the full parallel gate and 1517 every
        // time it ran with the machine to itself - one reference invocation failing for a reason that was
        // never captured. The mechanism is still unidentified: contention is only correlated, and a
        // deliberate attempt to reproduce it against a concurrent gcc sweep came back clean. Serializing is
        // therefore a precaution, not a diagnosis - it removes the one variable that tracked the symptom,
        // at ~90s of wall clock. The actual guard is compile-corpus's pinned rejection list, which fails
        // loudly and by name if it ever recurs.
        fileParallelism: false,
        // ~1500 gcc invocations plus the same number of in-process runs, against other suites running in
        // parallel on a contended runner. The timeout guards against hangs, not slowness.
        testTimeout: 600000,
        hookTimeout: 60000,
    },
});
