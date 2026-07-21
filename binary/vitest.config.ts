import { defineConfig } from "vitest/config";
import path from "path";
import { coverageConfig } from "../scripts/utils/src/vitest-coverage-config";

export default defineConfig({
    resolve: {
        alias: {
            "@bgforge/binary": path.resolve(__dirname, "./src/index.ts"),
        },
    },
    test: {
        name: "binary-lib",
        // Use an absolute include path so the config works both when run from the
        // package directory (pnpm test) and from the repo root (scripts/test.sh).
        include: [path.resolve(__dirname, "test/**/*.test.ts")],
        // CLI integration tests live alongside the unit tests but require the built
        // CLI bundle to exist; they run from scripts/vitest.cli.config.ts in a later phase.
        exclude: [path.resolve(__dirname, "test/**/*-cli.test.ts")],
        // v8 coverage instrumentation slows the binary parser tests, and the parallel
        // suite block in scripts/test.sh saturates all cores - on a 4-vCPU CI runner the
        // slowest MAP round-trip (denbus1.map) runs ~19s under that starvation, so 15s
        // times out. The timeout guards against hangs, not slowness; keep it generous.
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
