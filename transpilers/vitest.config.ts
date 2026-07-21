import { defineConfig } from "vitest/config";
import { coverageConfig } from "../scripts/utils/src/vitest-coverage-config";

export default defineConfig({
    test: {
        name: "transpile-lib",
        include: ["transpilers/test/**/*.test.ts"],
        // CLI integration tests live alongside the unit tests but require the built
        // CLI bundle to exist; they run from scripts/vitest.cli.config.ts in a later phase.
        exclude: ["transpilers/test/**/*-cli.test.ts"],
        testTimeout: 30000,
        // Floor reflects the unit-test slice only. The transpilers' larger
        // execution surface is exercised by api.test.ts, transpile-cli.test.ts,
        // and the test/td + test/tbaf fixture-driven integration suites in
        // scripts/test.sh - not by this vitest project. Threshold values are
        // ratcheted to just under the unit-suite actuals (57.7/66.0/43.6/56.5
        // at last ratchet); keep raising them as standalone unit tests are
        // added. See docs/architecture.md "Coverage thresholds" for the full
        // layering.
        coverage: coverageConfig({
            reportsDirectory: "coverage/transpile",
            thresholds: {
                lines: 56,
                functions: 65,
                branches: 42,
                statements: 55,
            },
        }),
    },
});
