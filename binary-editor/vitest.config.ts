import path from "node:path";
import { defineConfig } from "vitest/config";
import { coverageConfig } from "../scripts/utils/src/vitest-coverage-config";

export default defineConfig({
    resolve: {
        alias: {
            "@bgforge/binary": path.resolve(__dirname, "../binary/src/index.ts"),
        },
    },
    test: {
        name: "binary-editor",
        include: [path.resolve(__dirname, "test/**/*.test.ts")],
        // Module registry shared across files in a worker rather than rebuilt per file: measured 19.6s ->
        // 14.3s, because this suite's per-file import cost dominates its actual test time (import 67.7s ->
        // 22.6s). Safe here because no file in it calls vi.mock/vi.spyOn/vi.stubGlobal - every case builds
        // its own session from a fixture - and six shuffled-order runs of both this suite and transpilers
        // stayed green. A new test needing a fresh registry must avoid it, or this flag comes off.
        isolate: false,
        // v8 coverage instrumentation roughly doubles per-test time, and the parallel suite
        // block in scripts/test.sh saturates all cores - on a 4-vCPU CI runner the slowest
        // MAP-object test runs ~33s under that starvation. Same 60s ceiling as the binary
        // and client suites: the timeout guards against hangs, not slowness.
        testTimeout: 60000,
        // Pin the denominator to this package's source. The repo-root-relative glob is
        // deliberate: the coverage phase runs from the repo root (scripts/test.sh), and the
        // @bgforge/binary alias above instruments the sibling binary/src tree at test time, so
        // a bare "src/**" (which other packages use) would not exclude it and v8 would dilute
        // the ratio with binary/src files.
        //
        // Floors set just below the current measured coverage. Ratchet upward as it grows.
        coverage: coverageConfig({
            reportsDirectory: "coverage/binary-editor",
            include: ["binary-editor/src/**/*.ts"],
            thresholds: {
                lines: 91,
                functions: 87,
                branches: 76,
                statements: 86,
            },
        }),
    },
});
