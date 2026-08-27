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
        // The corpus differential once obtained 1516 oracles inside the full parallel gate and 1517 with
        // the machine to itself, for a reason that went uncaptured for a long time. It is captured now:
        // bounding the child turned the symptom into `killed by SIGTERM`, and the script it struck
        // compiles in 90ms on its own. The bundled compiler simply hangs on roughly one spawn in several
        // thousand. The optimise differential retries a KILLED child once for exactly that reason;
        // serialising here still helps by not multiplying the spawns competing at any moment.
        fileParallelism: false,
        // ~1500 gcc invocations plus the same number of in-process runs, against other suites running in
        // parallel on a contended runner. The timeout guards against hangs, not slowness.
        testTimeout: 600000,
        hookTimeout: 60000,
    },
});
