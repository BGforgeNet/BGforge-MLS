import { defineConfig } from "vitest/config";
import path from "path";
import { coverageConfig } from "../scripts/utils/src/vitest-coverage-config";

export default defineConfig({
    test: {
        name: "shared",
        include: [path.resolve(__dirname, "**/test/**/*.test.ts")],
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
