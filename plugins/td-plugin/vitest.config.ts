/**
 * Vitest configuration for TD TypeScript plugin unit tests.
 *
 * Coverage measures every source file imported by tests, no allow/deny list.
 * Thresholds pinned to current actuals so regressions fail the gate.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        name: "td-plugin",
        include: ["plugins/td-plugin/test/**/*.test.ts"],
        coverage: {
            provider: "v8",
            reporter: ["text", "html", "lcov"],
            // Maintainer-recommended workaround for the .tmp/coverage-N.json
            // ENOENT race under parallel coverage runs (vitest-dev/vitest
            // #4943, #5903). scripts/test.sh also serialises coverage jobs.
            clean: false,
            thresholds: {
                lines: 90,
                functions: 90,
                branches: 80,
                statements: 90,
            },
        },
    },
});
