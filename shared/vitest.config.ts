import { defineConfig } from "vitest/config";
import path from "path";
import { coverageConfig } from "../scripts/utils/src/vitest-coverage-config.ts";

export default defineConfig({
    test: {
        name: "shared",
        include: [path.resolve(import.meta.dirname, "**/test/**/*.test.ts")],
        // 60s like every suite in the parallel test.sh block: core saturation makes
        // near-threshold tests trip stochastically where cores are scarce (the CLI fan-out
        // tests spawn child processes); the timeout guards against hangs, not slowness.
        testTimeout: 60000,
        // Hooks get the same budget for the same reason: vitest defaults hookTimeout to 10s
        // whatever testTimeout is, so a hook that builds or checks a fixture trips it while
        // every test in the file passes.
        hookTimeout: 60000,
        // The shared/ tree contains a few small library-style helpers used
        // across packages. Threshold reflects the floor measured today.
        coverage: coverageConfig({
            reportsDirectory: "coverage/shared",
            thresholds: {
                lines: 99,
                functions: 89,
                branches: 97,
                statements: 99,
            },
        }),
    },
});
