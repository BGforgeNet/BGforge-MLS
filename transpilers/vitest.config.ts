import { defineConfig } from "vitest/config";
export default defineConfig({
    test: {
        name: "transpile-lib",
        include: ["transpilers/test/**/*.test.ts"],
        // CLI integration tests live alongside the unit tests but require the built
        // CLI bundle to exist; they run from test/vitest.cli.config.ts in a later phase.
        exclude: ["transpilers/test/**/*-cli.test.ts"],
        testTimeout: 30_000,
        coverage: {
            provider: "v8",
            reporter: ["text", "html", "lcov"],
            reportsDirectory: "coverage/transpile",
            // Maintainer-recommended workaround for the .tmp/coverage-N.json
            // ENOENT race under parallel coverage runs (vitest-dev/vitest
            // #4943, #5903). scripts/test.sh also serialises coverage jobs.
            clean: false,
            // Floor reflects the unit-test slice only. The transpilers' larger
            // execution surface is exercised by api.test.ts, transpile-cli.test.ts,
            // and the test/td + test/tbaf fixture-driven integration suites in
            // scripts/test.sh — not by this vitest project. Stryker
            // (stryker.conf.json) provides the higher mutation-aware bar for the
            // same code. Threshold values are deliberately at the unit-only floor;
            // raise them as standalone unit tests are added. See
            // docs/architecture.md "Coverage thresholds" for the full layering.
            thresholds: {
                lines: 15,
                functions: 25,
                branches: 8,
                statements: 15,
            },
        },
    },
});
