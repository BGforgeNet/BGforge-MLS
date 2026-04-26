import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
    test: {
        name: "shared",
        include: [path.resolve(__dirname, "**/test/**/*.test.ts")],
        coverage: {
            provider: "v8",
            reporter: ["text", "html", "lcov"],
            reportsDirectory: "coverage/shared",
            // The shared/ tree contains a few small library-style helpers used
            // across packages. Threshold reflects the floor measured today.
            thresholds: {
                lines: 97,
                functions: 87,
                branches: 89,
                statements: 96,
            },
        },
    },
});
