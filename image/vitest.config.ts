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
            thresholds: { lines: 100, functions: 100, branches: 77.14, statements: 97.88 },
        }),
    },
});
