import * as path from "path";
import { defineConfig } from "vitest/config";
import { coverageConfig } from "../../scripts/utils/src/vitest-coverage-config.ts";

export default defineConfig({
    test: {
        name: "tssl",
        // Absolute include so the config works from the package directory and from the repo root.
        include: [path.resolve(import.meta.dirname, "test/**/*.test.ts")],
        // The CLI test spawns the built bundle and runs from scripts/vitest.cli.config.ts once it
        // exists; without this it runs twice, and the subprocess copy is the slow one.
        exclude: [path.resolve(import.meta.dirname, "test/**/*-cli.test.ts")],
        // See binary-editor/vitest.config.ts for the rationale: reusing the worker's module registry
        // across files, which matters here because each file builds its own ts-morph project.
        isolate: false,
        // 60s like every suite in the parallel test.sh block: core saturation makes near-threshold tests
        // trip stochastically where cores are scarce, and building a ts-morph project per case is not fast.
        // The timeout guards against hangs, not slowness.
        testTimeout: 60000,
        coverage: coverageConfig({
            reportsDirectory: "coverage/tssl",
            // Scoped to this package. Without it v8 measures whatever the tests LOAD, which drags in the
            // SSL compiler and the shared transpiler helpers - both gated far harder by their own suites.
            include: ["src/**/*.ts"],
            exclude: [
                "**/compilers/ssl/src/**",
                "**/transpilers/**",
                // Covered by test/tssl-cli.test.ts, which spawns the built bundle - a subprocess is
                // invisible to in-process instrumentation, so counting it here would measure zero for
                // code that is in fact exercised.
                "src/cli.ts",
            ],
            // Measured floors for this unit slice, not aspirations - ratchet upward as tests are added.
            // They sit low because `int/lower.ts` (47%) is exercised mainly by `pnpm tssl-int-diff`,
            // which byte-compares a whole real mod through both routes and is a gate script rather than
            // a test, so none of it reaches this instrument. Those numbers are the reason to trust the
            // front end; these are only the reason to trust the unit tests.
            //
            // A point or so below what is measured, deliberately. Set flush against the measurement they
            // go red on the next refusal branch added without a test for it, which trains the reader to
            // edit the threshold rather than read the number.
            thresholds: {
                lines: 73,
                functions: 69,
                branches: 58,
                statements: 70,
            },
        }),
    },
});
