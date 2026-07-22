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
            thresholds: { lines: 0, functions: 0, branches: 0, statements: 0 },
        }),
    },
});
