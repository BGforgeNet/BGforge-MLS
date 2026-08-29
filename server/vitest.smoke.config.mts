/**
 * Vitest configuration for the server smoke test.
 * Separated from the main config because it requires a built server bundle.
 */

import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
    test: {
        name: "server-smoke",
        // Absolute so discovery works both from server/ and from the repo root.
        include: [
            path.resolve(import.meta.dirname, "test/smoke-stdio.test.ts"),
            path.resolve(import.meta.dirname, "test/lsp-probe.test.ts"),
            path.resolve(import.meta.dirname, "test/tssl-worker-smoke.test.ts"),
            path.resolve(import.meta.dirname, "test/transpile-worker-smoke.test.ts"),
        ],
        // 60s like every suite in the parallel test.sh block: core saturation makes
        // near-threshold tests trip stochastically on a 4-vCPU runner; the timeout
        // guards against hangs, not slowness.
        testTimeout: 60000,
    },
});
