import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
    resolve: {
        alias: {
            "@bgforge/format": path.resolve(__dirname, "./src/index.ts"),
        },
    },
    test: {
        name: "format-lib",
        // Use an absolute include path so the config works both when run from the
        // package directory (pnpm test) and from the repo root (scripts/test.sh).
        include: [path.resolve(__dirname, "test/**/*.test.ts")],
        // CLI integration tests live alongside the unit tests but require the built
        // CLI bundle to exist; they run from test/vitest.cli.config.ts in a later phase.
        exclude: [path.resolve(__dirname, "test/**/*-cli.test.ts")],
        testTimeout: 30_000,
        coverage: {
            provider: "v8",
            reporter: ["text", "html", "lcov"],
            reportsDirectory: "coverage/format",
            // Maintainer-recommended workaround for the .tmp/coverage-N.json
            // ENOENT race under parallel coverage runs (vitest-dev/vitest
            // #4943, #5903). scripts/test.sh also serialises coverage jobs.
            clean: false,
            include: ["src/**/*.ts"],
            // Floor reflects the unit-test slice only. Most of the formatter
            // surface is exercised by grammar-driven format-check fixtures
            // run from scripts/test.sh, which are out of scope here. Ratchet
            // upward as standalone unit tests are added. See
            // docs/architecture.md "Coverage thresholds" for the full layering.
            thresholds: {
                lines: 27,
                functions: 17,
                branches: 12,
                statements: 27,
            },
        },
    },
});
