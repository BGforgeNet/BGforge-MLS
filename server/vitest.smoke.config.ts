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
            path.resolve(__dirname, "test/smoke-stdio.test.ts"),
            path.resolve(__dirname, "test/lsp-probe.test.ts"),
        ],
        // 60s like every suite in the parallel test.sh block: core saturation makes
        // near-threshold tests trip stochastically on a 4-vCPU runner; the timeout
        // guards against hangs, not slowness.
        testTimeout: 60000,
    },
});
