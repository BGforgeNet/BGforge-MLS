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
            // Round floors a point under the measured actuals, so a real regression trips them
            // while a refactor that shifts the ratio a fraction does not. See
            // docs/development.md "Coverage thresholds" for when they move.
            thresholds: { lines: 99, functions: 99, branches: 88, statements: 97 },
        }),
    },
});
