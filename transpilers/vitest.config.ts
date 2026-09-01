import { defineConfig } from "vitest/config";
import path from "path";
import { coverageConfig } from "../scripts/utils/src/vitest-coverage-config.ts";

export default defineConfig({
    test: {
        name: "transpile-lib",
        // Absolute so discovery works both from transpilers/ and from the repo root
        // (scripts/test.sh invokes this config from root).
        include: [path.resolve(import.meta.dirname, "test/**/*.test.ts")],
        // CLI integration tests live alongside the unit tests but require the built
        // CLI bundle to exist; they run from scripts/vitest.cli.config.ts in a later phase.
        exclude: [path.resolve(import.meta.dirname, "test/**/*-cli.test.ts")],
        // 60s like every suite in the parallel test.sh block: core saturation makes
        // near-threshold tests trip stochastically where cores are scarce; the timeout
        // guards against hangs, not slowness.
        testTimeout: 60000,
        // See binary-editor/vitest.config.ts for the rationale and the constraint it puts on new tests:
        // reusing the worker's module registry across files, measured 11.5s -> 9.9s here.
        isolate: false,
        // Floor reflects the unit-test slice only. The transpilers' larger
        // execution surface is exercised by api.test.ts, transpile-cli.test.ts,
        // and the test/td + test/tbaf fixture-driven integration suites in
        // scripts/test.sh - not by this vitest project. Threshold values are
        // ratcheted to just under the unit-suite actuals (74.3/79.4/59.0/72.8
        // at last ratchet); keep raising them as standalone unit tests are
        // added. See docs/architecture.md "Coverage thresholds" for the full
        // layering.
        coverage: coverageConfig({
            reportsDirectory: "coverage/transpile",
            // Scoped to this package's own sources. Without it v8 measures whatever the tests happened to
            // LOAD, so a cross-workspace import drags another package in at whatever coverage it gets
            // here - `compilers/ssl/src` arrived that way once the TSSL front end started targeting the
            // IR, ~6000 lines at 1-2%, and those files already answer to their own far stricter gate.
            include: ["common/**/*.ts", "src/**/*.ts", "tbaf/src/**/*.ts", "td/src/**/*.ts", "tssl/src/**/*.ts"],
            // The include above scopes what is INSIDE this package; it cannot reach a file outside it,
            // whose path relativises to `../..` and slips past every pattern. Cross-workspace imports
            // therefore need excluding by name - both these packages gate their own coverage, and far
            // higher (ssl at 97% lines, shared at 99%), so counting them here measured nothing and
            // masked this package's real figure. Spelled out to the source directory rather than as
            // `**/compilers/**`: this package is a candidate to move under `compilers/`, and the broad
            // form would silently zero its own denominator on the day it does.
            exclude: ["**/compilers/ssl/src/**", "**/shared/*.ts"],
            thresholds: {
                lines: 73,
                functions: 78,
                branches: 58,
                statements: 71,
            },
        }),
    },
});
