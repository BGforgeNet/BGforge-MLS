import { defineConfig } from "vitest/config";
import path from "path";
import { coverageConfig } from "../scripts/utils/src/vitest-coverage-config.ts";

export default defineConfig({
    resolve: {
        // Map the workspace packages to their sources so vitest runs without a build step, the way every
        // other package config here does. `@bgforge/binary` is test-only: the corpus suites open a real
        // install, while src/ reads a game through the structural GameHandle.
        alias: {
            "@bgforge/binary": path.resolve(import.meta.dirname, "../binary/src/index.ts"),
            "@bgforge/image/ie-direction": path.resolve(import.meta.dirname, "../image/src/model/ie-direction.ts"),
            "@bgforge/image": path.resolve(import.meta.dirname, "../image/src/index.ts"),
        },
    },
    test: {
        name: "animation-lib",
        // Absolute so discovery works from this directory and from the repo root alike; a repo-root-relative
        // glob silently matches 0 files when run from here.
        include: [path.resolve(import.meta.dirname, "test/**/*.test.ts")],
        testTimeout: 60000,
        // Hooks get the same budget: vitest defaults hookTimeout to 10s whatever testTimeout is, so a hook
        // that opens an install trips it while every test in the file passes.
        hookTimeout: 60000,
        coverage: coverageConfig({
            reportsDirectory: "coverage/animation",
            include: ["animation/src/**/*.ts"],
            // Floors set to the measured actuals when this package was split out of the client, per the
            // convention the sibling configs follow: they may be raised as coverage improves, never lowered.
            // set-stances.ts measures lower here than it did in the client, because the client's set-viewer
            // suite also drives it and stayed behind - that coverage is real but is counted against neither
            // package's sources, so these floors understate what is exercised.
            thresholds: { lines: 100, functions: 100, branches: 94.47, statements: 98.65 },
        }),
    },
});
