/**
 * Vitest configuration for server unit tests with coverage reporting.
 *
 * Coverage measures every source file the unit tests import. Exclusions:
 *   - `src/**\/format/**` — tree-sitter format sub-modules operate on parsed
 *     AST nodes and are covered by grammar-corpus tests, not unit tests.
 *   - `src/fallout-ssl/provider.ts`, `src/weidu-tp2/provider.ts` — LSP
 *     dispatcher glue that delegates to unit-tested sub-modules; end-to-end
 *     behaviour is verified by integration tests under `test/integration/`.
 *
 * See INTERNALS.md "Coverage scope".
 */

import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
    resolve: {
        // Map the workspace package to its source so vitest can import it
        // without requiring a build step. The built out/ does not exist until
        // pnpm --filter @bgforge/format build runs, but tests run from source.
        alias: {
            "@bgforge/format": path.resolve(__dirname, "../format/src/index.ts"),
        },
    },
    test: {
        name: "server",
        include: ["test/**/*.test.ts"],
        exclude: ["test/smoke-stdio.test.ts", "test/integration/**"],
        testTimeout: 30_000,
        coverage: {
            provider: "v8",
            reporter: ["text", "html", "lcov"],
            // Separate from the client's coverage output so the parallel
            // server+client coverage runs in scripts/test.sh don't race on
            // coverage/.tmp shard files.
            reportsDirectory: "coverage/server",
            exclude: ["src/**/format/**/*.ts", "src/fallout-ssl/provider.ts", "src/weidu-tp2/provider.ts"],
            thresholds: {
                lines: 90,
                functions: 90,
                branches: 80,
                statements: 90,
            },
        },
    },
});
