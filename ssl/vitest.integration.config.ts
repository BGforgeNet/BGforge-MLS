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
        // ~1500 gcc invocations plus the same number of in-process runs, against other suites running in
        // parallel on a contended runner. The timeout guards against hangs, not slowness.
        testTimeout: 600000,
        hookTimeout: 60000,
    },
});
