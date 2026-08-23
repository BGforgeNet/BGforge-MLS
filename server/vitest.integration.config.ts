/**
 * Vitest configuration for integration tests using real external fixture files.
 *
 * Separated from the main config because these tests require external repos
 * to be cloned (via scripts/test-external.sh or pnpm test:external).
 * Run with: cd server && pnpm test:integration
 */

import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
    resolve: {
        // Map the workspace package to its source so vitest can import it
        // without requiring a build step (mirrors vitest.config.ts).
        alias: {
            "@bgforge/format/internal": path.resolve(__dirname, "../format/src/internal.ts"),
            "@bgforge/format": path.resolve(__dirname, "../format/src/index.ts"),
        },
    },
    test: {
        name: "server-integration",
        // Absolute so discovery works both from server/ (pnpm test:integration) and
        // from the repo root; a bare "test/**" glob resolves against process.cwd().
        include: [path.resolve(__dirname, "test/integration/**/*.test.ts")],
        setupFiles: [path.resolve(__dirname, "test/integration/setup.ts")],
        // These tests sweep real external corpora (hundreds of tree-sitter parses) while
        // other suites run in parallel - a CPU-contended CI runner is far slower than a
        // local run, and near-threshold tests trip stochastically. 60s like every suite
        // in the block; the timeout guards against hangs, not slowness.
        testTimeout: 60000,
        // Same reasoning, and these suites need it MORE than the test bodies do: the corpus sweeping happens
        // in beforeAll, which otherwise keeps vitest's 10s default while the tests it feeds get 60s. The
        // tssl write-back hook parses its corpus in ~9s idle, so a contended run failed the hook, not a test.
        hookTimeout: 60000,
    },
});
