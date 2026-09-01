import { defineConfig } from "vitest/config";
import path from "path";
import { coverageConfig } from "../scripts/utils/src/vitest-coverage-config.ts";

export default defineConfig({
    resolve: {
        alias: {
            "@bgforge/format/internal": path.resolve(import.meta.dirname, "./src/internal.ts"),
            "@bgforge/format": path.resolve(import.meta.dirname, "./src/index.ts"),
        },
    },
    test: {
        name: "format-lib",
        // Use an absolute include path so the config works both when run from the
        // package directory (pnpm test) and from the repo root (scripts/test.sh).
        include: [path.resolve(import.meta.dirname, "test/**/*.test.ts")],
        // CLI integration tests live alongside the unit tests but require the built
        // CLI bundle to exist; they run from scripts/vitest.cli.config.ts in a later phase.
        exclude: [path.resolve(import.meta.dirname, "test/**/*-cli.test.ts")],
        // 60s like every suite in the parallel test.sh block: core saturation makes
        // near-threshold tests trip stochastically where cores are scarce; the timeout
        // guards against hangs, not slowness.
        testTimeout: 60000,
        // The tree-sitter-driven formatters (one dir per grammar) are
        // exercised by the grammar format-check fixtures run from
        // scripts/test.sh / test:grammars, not by vitest unit tests, so they
        // are out of scope for this gate. Excluding them keeps the threshold
        // measuring the unit-tested pure formatters rather than diluting it
        // with code another suite owns. See docs/architecture.md
        // "Coverage thresholds" for the full layering.
        //
        // Floor reflects the unit-tested pure-formatter slice (ratcheted to
        // current actuals now that the grammar-driven dirs are excluded);
        // ratchet upward as standalone unit tests are added. Floors sit a
        // margin below the actuals because the property tests (fast-check)
        // vary which branches run per seed - branches observed 74.7-76.0,
        // statements 81.7-81.9 - so a floor at the actual would flake.
        coverage: coverageConfig({
            reportsDirectory: "coverage/format",
            include: ["src/**/*.ts"],
            exclude: ["src/fallout-ssl/**", "src/weidu-baf/**", "src/weidu-d/**", "src/weidu-tp2/**"],
            thresholds: {
                lines: 82,
                functions: 86,
                branches: 73,
                statements: 81,
            },
        }),
    },
});
