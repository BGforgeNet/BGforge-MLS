import { defineConfig } from "vitest/config";
import path from "path";
import { coverageConfig } from "../scripts/utils/src/vitest-coverage-config.ts";

export default defineConfig({
    resolve: {
        alias: {
            "@bgforge/binary": path.resolve(import.meta.dirname, "./src/index.ts"),
        },
    },
    test: {
        name: "binary-lib",
        // Use an absolute include path so the config works both when run from the
        // package directory (pnpm test) and from the repo root (scripts/test.sh).
        include: [path.resolve(import.meta.dirname, "test/**/*.test.ts")],
        // CLI integration tests live alongside the unit tests but require the built
        // CLI bundle to exist; they run from scripts/vitest.cli.config.ts in a later phase.
        exclude: [path.resolve(import.meta.dirname, "test/**/*-cli.test.ts")],
        // Resets drifted external/ fixtures (mutated by a live editor session) before any
        // test runs, so a stale fixture surfaces as a visible reset instead of a confusing
        // byte-mismatch assertion deep in the suite.
        globalSetup: [path.resolve(import.meta.dirname, "test/global-setup.ts")],
        // v8 coverage instrumentation slows the binary parser tests, and the parallel
        // suite block in scripts/test.sh saturates all cores - where cores are scarce the
        // slowest MAP round-trip (denbus1.map) runs many times its solo time, so a tight
        // ceiling times out. The timeout guards against hangs, not slowness; keep it generous.
        testTimeout: 60000,
        // Pin the denominator to this package's source so transitive
        // workspace deps (e.g. @bgforge/format aliased above its tests)
        // cannot dilute the ratio.
        //
        // Thresholds set at the floor measured by this unit-test slice.
        // CLI integration tests live in a separate vitest project and are
        // not counted here. Ratchet upward as coverage grows.
        coverage: coverageConfig({
            reportsDirectory: "coverage/binary",
            include: ["src/**/*.ts"],
            thresholds: {
                lines: 90,
                functions: 91,
                branches: 77,
                statements: 88,
            },
        }),
    },
});
