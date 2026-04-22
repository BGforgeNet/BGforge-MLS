/**
 * Vitest configuration for all data update script tests with coverage reporting.
 *
 * Coverage measures every source file imported by tests, no allow/deny list.
 * Thresholds pinned to current actuals so regressions fail the gate.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        name: "scripts",
        include: ["scripts/*/test/**/*.test.ts"],
        testTimeout: 30_000,
        coverage: {
            provider: "v8",
            reporter: ["text", "html", "lcov"],
            thresholds: {
                lines: 90,
                functions: 90,
                branches: 80,
                statements: 90,
            },
        },
    },
});
