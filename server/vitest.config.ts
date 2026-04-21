/**
 * Vitest configuration for server unit tests with coverage reporting.
 *
 * Coverage measures every source file the unit tests import. The only
 * exclusion is tree-sitter format sub-modules (`src/**\/format/**`): those
 * operate on parsed AST nodes and are covered by grammar-corpus tests, not
 * unit tests. See INTERNALS.md "Coverage scope".
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        name: "server",
        include: ["test/**/*.test.ts"],
        exclude: ["test/smoke-stdio.test.ts", "test/integration/**"],
        testTimeout: 30000,
        coverage: {
            provider: "v8",
            reporter: ["text", "html", "lcov"],
            exclude: ["src/**/format/**/*.ts"],
            thresholds: {
                lines: 80,
                functions: 80,
                // Branch coverage is lower because completion context detectors
                // have many guard-clause branches for rare AST edge cases.
                branches: 75,
                statements: 80,
            },
        },
    },
});
