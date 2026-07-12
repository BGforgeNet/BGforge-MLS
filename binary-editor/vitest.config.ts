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
        // v8 coverage instrumentation roughly doubles per-test time and pushes the slowest
        // MAP-object test past the uninstrumented 15s ceiling; give the instrumented run
        // headroom (uninstrumented tests still finish well under this).
        testTimeout: 30000,
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
