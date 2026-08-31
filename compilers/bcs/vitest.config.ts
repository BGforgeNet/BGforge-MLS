import path from "path";
import { defineConfig } from "vitest/config";
import { coverageConfig } from "../../scripts/utils/src/vitest-coverage-config.ts";

export default defineConfig({
    resolve: {
        alias: {
            "@bgforge/bcs": path.resolve(import.meta.dirname, "./src/index.ts"),
        },
    },
    test: {
        name: "bcs",
        // Absolute include so the config works from the package directory and from the repo root.
        include: [path.resolve(import.meta.dirname, "test/**/*.test.ts")],
        coverage: coverageConfig({
            reportsDirectory: "coverage/bcs",
            include: ["src/**/*.ts"],
            // The include above scopes what is INSIDE this package; a file outside it relativises to
            // `../..` and slips past every pattern, so a cross-workspace import has to be excluded by
            // name - the same trap transpilers/vitest.config.ts documents. weidu-differential.test.ts
            // imports the shared WeiDU resolver, which is test infrastructure rather than code under
            // test, and counting it dropped this package's measured lines from 100% to 98.31%.
            exclude: ["**/scripts/utils/src/**"],
            // Floor measured by this suite; ratchet upward as the package grows. Branches sit lower than
            // the rest because `noUncheckedIndexedAccess` forces `?.`/`??` guards on token reads that the
            // cursor's own `take` has already ruled out - those arms are unreachable rather than untested.
            thresholds: {
                lines: 100,
                functions: 100,
                branches: 82,
                statements: 99,
            },
        }),
    },
});
