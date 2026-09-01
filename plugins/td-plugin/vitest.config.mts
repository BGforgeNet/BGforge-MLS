/**
 * Vitest configuration for TD TypeScript plugin unit tests.
 *
 * Coverage measures every source file imported by tests, no allow/deny list.
 * Thresholds pinned to current actuals so regressions fail the gate.
 */

import { defineConfig } from "vitest/config";
import path from "path";
import { coverageConfig } from "../../scripts/utils/src/vitest-coverage-config.ts";

export default defineConfig({
    test: {
        name: "td-plugin",
        // Absolute so discovery works both from this dir and from the repo root
        // (scripts/test.sh invokes this config from root).
        include: [path.resolve(import.meta.dirname, "test/**/*.test.ts")],
        // 60s like every suite in the parallel test.sh block: core saturation makes
        // near-threshold tests trip stochastically where cores are scarce; the timeout
        // guards against hangs, not slowness.
        testTimeout: 60000,
        // Hooks get the same budget for the same reason: vitest defaults hookTimeout to 10s
        // whatever testTimeout is, so a hook that builds or checks a fixture trips it while
        // every test in the file passes.
        hookTimeout: 60000,
        coverage: coverageConfig({
            reportsDirectory: "coverage/td-plugin",
            thresholds: {
                lines: 100,
                functions: 100,
                branches: 88,
                statements: 100,
            },
        }),
    },
});
