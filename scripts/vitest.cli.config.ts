/**
 * Vitest configuration for cross-package CLI integration tests.
 *
 * Each per-package vitest config (binary, format, transpilers, ssl) excludes its
 * own `*-cli.test.ts` from the unit-test phase because those tests spawn the
 * built CLI bundle as a child process and would fail before Phase 2 produces
 * the bundles. This config re-includes them so the suite can be gated as a
 * single phase that runs after the CLIs are built.
 *
 * No coverage thresholds: subprocess instrumentation via child_process does
 * not capture v8 in-process coverage. Per-package smoke `describe` blocks
 * substitute behavioural verification for a numeric coverage gate.
 */

import { defineConfig } from "vitest/config";
import path from "path";

const root = path.resolve(import.meta.dirname, "..");

export default defineConfig({
    test: {
        name: "cli-integration",
        include: [
            path.resolve(root, "binary/test/bin-cli.test.ts"),
            path.resolve(root, "format/test/format-cli.test.ts"),
            path.resolve(root, "transpilers/test/transpile-cli.test.ts"),
            path.resolve(root, "compilers/ssl/test/ssl-cli.test.ts"),
            path.resolve(root, "compilers/tssl/test/tssl-cli.test.ts"),
            path.resolve(root, "scripts/utils/test/cli-help.test.ts"),
        ],
        // 60s like every suite in the parallel test.sh block: core saturation makes
        // near-threshold tests trip stochastically where cores are scarce; the timeout
        // guards against hangs, not slowness.
        testTimeout: 60000,
        // Hooks get the same budget for the same reason: vitest defaults hookTimeout to 10s
        // whatever testTimeout is, so a hook that builds or checks a fixture trips it while
        // every test in the file passes.
        hookTimeout: 60000,
    },
});
