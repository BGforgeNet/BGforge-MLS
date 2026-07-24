import { defineConfig } from "vitest/config";
import path from "path";
import { coverageConfig } from "../scripts/utils/src/vitest-coverage-config";

export default defineConfig({
    resolve: {
        alias: { "@bgforge/image": path.resolve(__dirname, "./src/index.ts") },
    },
    test: {
        name: "image-lib",
        include: [path.resolve(__dirname, "test/**/*.test.ts")],
        testTimeout: 60000,
        coverage: coverageConfig({
            reportsDirectory: "coverage/image",
            include: ["src/**/*.ts"],
            // Floor set to the measured actuals (deterministic suite, no
            // property-test seed variance); ratchet up as coverage improves.
            // branches dropped from 87.86 to 87.65: the Phase 3 review's palette/tRNS
            // dedup (parseHeaderAndPalette, shared by decodeIndexedPng/decodeApng)
            // merged duplicate copies of a noUncheckedIndexedAccess-mandated guard that
            // is unreachable at runtime (entryCount bounds already guarantee r/g/b and
            // the palette slot are defined) - fewer total uncovered branches, but a
            // smaller branch-count denominator shifts the ratio down slightly.
            thresholds: { lines: 100, functions: 100, branches: 87.65, statements: 98.34 },
        }),
    },
});
