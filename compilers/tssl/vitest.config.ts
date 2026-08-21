import * as path from "path";
import { defineConfig } from "vitest/config";
import { coverageConfig } from "../../scripts/utils/src/vitest-coverage-config";

export default defineConfig({
    test: {
        name: "tssl",
        // Absolute include so the config works from the package directory and from the repo root.
        include: [path.resolve(__dirname, "test/**/*.test.ts")],
        // See binary-editor/vitest.config.ts for the rationale: reusing the worker's module registry
        // across files, which matters here because each file builds its own ts-morph project.
        isolate: false,
        coverage: coverageConfig({
            reportsDirectory: "coverage/tssl",
            // Scoped to this package. Without it v8 measures whatever the tests LOAD, which drags in the
            // SSL compiler and the shared transpiler helpers - both gated far harder by their own suites.
            include: ["src/**/*.ts"],
            exclude: ["**/compilers/ssl/src/**", "**/transpilers/**"],
            // Floor measured by this slice; the CLI is covered by its own subprocess suite, which
            // in-process instrumentation cannot see.
            thresholds: {
                lines: 80,
                functions: 85,
                branches: 65,
                statements: 78,
            },
        }),
    },
});
