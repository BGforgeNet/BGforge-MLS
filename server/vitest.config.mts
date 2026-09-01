/**
 * Vitest configuration for server unit tests with coverage reporting.
 *
 * Coverage measures every source file the unit tests import. Exclusions - the
 * per-language `provider.ts` LSP dispatchers: thin glue that delegates every
 * feature to unit-tested sub-modules, with end-to-end behaviour verified by
 * integration tests under `test/integration/`. Unit-testing a dispatcher would
 * duplicate its sub-modules' tests, so ALL provider dispatchers are excluded
 * uniformly rather than a subset. Their delegated logic is covered elsewhere -
 * e.g. weidu-baf via `test/integration/weidu-baf.test.ts` (plus
 * `test/weidu-baf/*`), weidu-d via `test/integration/weidu-d.test.ts`,
 * infinity-2da via `test/infinity-2da/semantic-tokens.test.ts`, weidu-log via
 * `test/weidu-log/definition.test.ts`.
 *
 * See INTERNALS.md "Coverage scope".
 */

import { defineConfig } from "vitest/config";
import path from "path";
import { coverageConfig } from "../scripts/utils/src/vitest-coverage-config.ts";

export default defineConfig({
    resolve: {
        // Map the workspace package to its source so vitest can import it
        // without requiring a build step. The built out/ does not exist until
        // pnpm --filter @bgforge/format build runs, but tests run from source.
        alias: {
            "@bgforge/binary/archive": path.resolve(import.meta.dirname, "../binary/src/archive/index.ts"),
            "@bgforge/format/internal": path.resolve(import.meta.dirname, "../format/src/internal.ts"),
            "@bgforge/format": path.resolve(import.meta.dirname, "../format/src/index.ts"),
        },
    },
    test: {
        name: "server",
        // Absolute so discovery works both from server/ (pnpm test:unit) and from the
        // repo root (scripts/test.sh), which is the only invocation that also passes
        // --coverage; a bare "test/**" glob resolves against process.cwd() and silently
        // matches 0 files when the caller's cwd is the repo root.
        include: [path.resolve(import.meta.dirname, "test/**/*.test.ts")],
        // smoke-stdio and lsp-probe spawn the built server/out bundle, which Phase 2 of
        // scripts/test.sh produces AFTER this suite runs - they live in vitest.smoke.config.mts.
        exclude: [
            path.resolve(import.meta.dirname, "test/smoke-stdio.test.ts"),
            path.resolve(import.meta.dirname, "test/lsp-probe.test.ts"),
            path.resolve(import.meta.dirname, "test/tssl-worker-smoke.test.ts"),
            path.resolve(import.meta.dirname, "test/transpile-worker-smoke.test.ts"),
            path.resolve(import.meta.dirname, "test/integration/**"),
        ],
        // 60s like every suite in the parallel test.sh block: core saturation makes
        // near-threshold tests trip stochastically where cores are scarce (the .td cohort
        // parse ran well past its old ceiling there); the timeout guards against hangs, not slowness.
        testTimeout: 60000,
        // Hooks get the same budget for the same reason: vitest defaults hookTimeout to 10s
        // whatever testTimeout is, so a hook that builds or checks a fixture trips it while
        // every test in the file passes.
        hookTimeout: 60000,
        // Separate from the client's coverage output so the parallel
        // server+client coverage runs in scripts/test.sh don't race on
        // coverage/.tmp shard files.
        //
        // Coverage is intentionally scoped to "files actually loaded by tests"
        // (the v8 default - no `include`). Adding `include: ["src/**/*.ts"]`
        // would also count integration-only modules and the tree-sitter
        // generated types in the denominator, which the unit slice cannot
        // realistically cover. The `@bgforge/format` alias above resolves
        // to format/src/ but tests load only a thin slice of it; add an
        // explicit `include` here only after auditing exactly which files
        // the unit suite touches.
        coverage: coverageConfig({
            reportsDirectory: "coverage/server",
            exclude: [
                "src/fallout-ssl/provider.ts",
                "src/weidu-tp2/provider.ts",
                "src/weidu-d/provider.ts",
                "src/weidu-baf/provider.ts",
                "src/fallout-worldmap/provider.ts",
                "src/infinity-2da/provider.ts",
                "src/weidu-log/provider.ts",
            ],
            thresholds: {
                lines: 91,
                functions: 96,
                branches: 80,
                statements: 90,
            },
        }),
    },
});
