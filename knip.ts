import type { KnipConfig } from "knip";

const isProductionKnip = process.argv.includes("--production");

const config: KnipConfig = {
    rules: {
        types: "error",
        // Knip can't trace enum member access (e.g. DeclarationKind.Set) as usage
        enumMembers: "off",
    },
    workspaces: {
        client: {
            entry: [
                // esbuild entry points (moved from package.json to scripts/*.sh)
                "src/extension.ts",
                "src/editors/binaryEditor-webview.ts",
                "src/dialog-tree/dialogTree-webview.ts",
                // test entry points for @vscode/test-electron
                "src/test/runTest.ts",
                "src/test/index.ts",
                "src/test/*.test.ts",
                // vitest unit tests (run via client/vitest.config.ts)
                "test/*.test.ts",
            ],
        },
        server: {
            // Point knip at the TypeScript source entry directly.
            // The package.json "main" field targets the built JS output.
            entry: ["src/server.ts"],
            // Created at runtime by enum-transform.test.ts, may exist during parallel Knip runs
            ignore: [
                "**/*.d.ts",
                // Built JS bundles (knip 6.6+ reports these as unused files otherwise).
                // Pattern is only present when build has run; knip hints "Remove from ignore"
                // before build, but the ignore is still required after build.
                "out/**",
                // .ts symlinks created by typecheck-samples.sh, may exist during parallel runs
                "test/td/*.ts",
                // Bench files invoked explicitly; not reachable from server.ts entry
                "test/perf/**",
                ...(isProductionKnip ? ["src/**", "vitest.integration.config.ts", "test/integration/**"] : []),
            ],
        },
        "plugins/tssl-plugin": {
            entry: ["src/index.ts", "test/*.test.ts"],
        },
        "plugins/td-plugin": {
            entry: ["src/index.ts", "test/*.test.ts"],
        },
        "transpilers/tssl": {
            entry: ["src/index.ts"],
        },
        "transpilers/tbaf": {
            entry: ["src/index.ts"],
        },
        "transpilers/td": {
            entry: ["src/index.ts"],
        },
        "transpilers/common": {
            entry: [],
        },
        transpilers: {
            entry: ["test/**/*.test.ts"],
            // esbuild-wasm is listed as a runtime dependency so the published bundle can
            // resolve it from node_modules (it refuses to be inlined — see tsup.config.ts).
            // Knip sees no TS import within this workspace because the import lives in
            // transpilers/common (a separate workspace); ignoreDependencies suppresses the
            // false-positive "unused dependency" report.
            // cac and diff are imported via shared/cli/cli-utils.ts, which is not part of
            // any workspace; knip's per-workspace dep tracing doesn't reach across that
            // non-workspace boundary, so suppress the false positive.
            ignoreDependencies: ["esbuild-wasm", "cac", "diff"],
        },
        format: {
            entry: ["test/**/*.test.ts"],
            // quick-lru is needed once Phase 7 moves the parser-factory into this package.
            // cac and diff are imported via shared/cli/cli-utils.ts, which is outside any
            // workspace; knip's per-workspace dep tracing doesn't reach across that boundary.
            ignoreDependencies: ["quick-lru", "cac", "diff"],
        },
    },
    ignore: [
        // tree-sitter grammars, not TypeScript
        "grammars/**",
        // CLI packages bundled by esbuild, import across workspace boundaries
        "cli/**",
        // external repositories cloned for testing
        "external/**",
        // standalone update scripts run via pnpm exec tsx, not imported by main code
        "scripts/**",
    ],
    ignoreDependencies: [
        // icon font used via CSS classes in dialogTree.ts (e.g. "codicon codicon-references")
        "@vscode/codicons",
        // invoked via pnpm exec in scripts
        "oxfmt",
        // invoked via pnpm vsce in scripts/package.sh
        "@vscode/vsce",
        // loaded by remark CLI via --use in package.json scripts, not statically imported
        "remark-validate-links",
    ],
};

export default config;
