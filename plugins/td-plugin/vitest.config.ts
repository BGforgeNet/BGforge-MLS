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
            thresholds: {
                lines: 94,
                functions: 100,
                branches: 76,
                statements: 92,
            },
        },
    },
});
