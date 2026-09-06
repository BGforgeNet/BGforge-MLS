import { defineConfig } from "vitest/config";
import path from "path";
import { coverageConfig } from "../scripts/utils/src/vitest-coverage-config.ts";

export default defineConfig({
    resolve: {
        // Map the workspace packages to their sources so vitest runs without a build step, the way every
        // other package config here does. `@bgforge/binary` is test-only: the corpus suites open a real
        // install, while src/ reads a game through the structural GameHandle.
        alias: {
            "@bgforge/animation": path.resolve(import.meta.dirname, "./src/index.ts"),
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
            // Repo-root-relative, matching the absolute test include above: the coverage tier runs every
            // package's config from the repo root, where a bare `src/**` widens the denominator to the
            // workspace sources this config aliases in (binary/src, image/src) instead of restricting it.
            include: ["animation/src/**/*.ts"],
            // Round floors a point under the measured actuals, so a real regression trips them while a
            // refactor that shifts the ratio a fraction does not. See docs/architecture.md "Coverage
            // thresholds" for when they move. set-stances.ts measures lower here than it did in the client,
            // because the client's set-viewer suite also drives it and stayed behind - that coverage is real
            // but is counted against neither package's sources, so these floors understate what is exercised.
            thresholds: { lines: 99, functions: 99, branches: 95, statements: 98 },
        }),
    },
});
