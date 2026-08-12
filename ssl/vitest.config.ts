import path from "path";
import { defineConfig } from "vitest/config";
import { coverageConfig } from "../scripts/utils/src/vitest-coverage-config";

export default defineConfig({
    resolve: {
        alias: {
            "@bgforge/ssl": path.resolve(__dirname, "./src/index.ts"),
        },
    },
    test: {
        name: "ssl",
        // Absolute include so the config works from the package directory and from the repo root.
        include: [path.resolve(__dirname, "test/**/*.test.ts")],
        // The gcc differential needs the external corpus; it runs from vitest.integration.config.ts
        // in the close-out phase, alongside the other external-corpus suites.
        exclude: [path.resolve(__dirname, "test/integration/**")],
        coverage: coverageConfig({
            reportsDirectory: "coverage/ssl",
            include: ["src/**/*.ts"],
            // Floor measured by this unit slice; ratchet upward as the front end grows. Branches sit
            // lower than the rest because noUncheckedIndexedAccess forces `undefined` guards on indexed
            // reads inside bounded loops, and those arms are unreachable rather than untested.
            thresholds: {
                lines: 97,
                functions: 100,
                branches: 82,
                statements: 93,
            },
        }),
    },
});
