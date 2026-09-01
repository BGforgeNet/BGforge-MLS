import { defineConfig } from "vitest/config";
import path from "path";
import { coverageConfig } from "../scripts/utils/src/vitest-coverage-config.ts";

export default defineConfig({
    resolve: {
        alias: { "@bgforge/image": path.resolve(import.meta.dirname, "./src/index.ts") },
    },
    test: {
        name: "image-lib",
        include: [path.resolve(import.meta.dirname, "test/**/*.test.ts")],
        testTimeout: 60000,
        // Hooks get the same budget for the same reason: vitest defaults hookTimeout to 10s
        // whatever testTimeout is, so a hook that builds or checks a fixture trips it while
        // every test in the file passes.
        hookTimeout: 60000,
        coverage: coverageConfig({
            reportsDirectory: "coverage/image",
            include: ["src/**/*.ts"],
            // Floor set to the measured actuals (deterministic suite, no
            // property-test seed variance); ratchet up as coverage improves.
            // branches dropped from 87.86 to 87.65 when the palette/tRNS parsing was
            // deduplicated into parseHeaderAndPalette (shared by decodeIndexedPng/decodeApng),
            // merging duplicate copies of a noUncheckedIndexedAccess-mandated guard that
            // is unreachable at runtime (entryCount bounds already guarantee r/g/b and
            // the palette slot are defined) - fewer total uncovered branches, but a
            // smaller branch-count denominator shifts the ratio down slightly.
            // branches rose from 87.65 to 88.71 (and statements from 98.34 to 98.56) when the BC
            // codecs moved onto reused scratch buffers: their palette/ramp/pixel reads are indexed
            // by computed block geometry, so they assert with `!` rather than adding a `?? 0`
            // fallback per channel that nothing can reach.
            thresholds: { lines: 100, functions: 100, branches: 88.71, statements: 98.56 },
        }),
    },
});
