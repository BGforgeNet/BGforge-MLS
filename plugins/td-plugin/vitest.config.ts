/**
 * Vitest configuration for TD TypeScript plugin unit tests.
 *
 * Coverage measures every source file imported by tests, no allow/deny list.
 * Thresholds pinned to current actuals so regressions fail the gate.
 */

import { defineConfig } from "vitest/config";
import { coverageConfig } from "../../scripts/utils/src/vitest-coverage-config";

export default defineConfig({
    test: {
        name: "td-plugin",
        include: ["plugins/td-plugin/test/**/*.test.ts"],
        coverage: coverageConfig({
            thresholds: {
                lines: 100,
                functions: 100,
                branches: 88,
                statements: 100,
            },
        }),
    },
});
