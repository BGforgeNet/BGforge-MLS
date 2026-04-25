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
            // esbuild-wasm is marked --external in scripts/build-base-server.sh and loaded
            // at runtime from server/node_modules by transpilers/common/{esbuild-utils,
            // enum-transform}.ts (which knip can't trace because transpilers/common has no
            // entry). package.sh also copies server/node_modules/esbuild-wasm into the VSIX.
            ignoreDependencies: ["esbuild-wasm"],
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
        "transpilers/cli": {
            entry: ["src/cli.ts"],
            // esbuild is invoked via scripts/build-transpile-cli.sh, not imported in source
            ignoreDependencies: ["esbuild"],
        },
        transpilers: {
            entry: ["src/index.ts", "test/**/*.test.ts"],
            // esbuild-wasm is listed as a runtime dependency so the published bundle can
            // resolve it from node_modules (it refuses to be inlined — see tsup.config.ts).
            // Knip sees no TS import within this workspace because the import lives in
            // transpilers/common (a separate workspace); ignoreDependencies suppresses the
            // false-positive "unused dependency" report.
            ignoreDependencies: ["esbuild-wasm"],
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
    ignoreBinaries: [
        // invoked via `cd transpilers && pnpm exec tsup` in root package.json build:transpile;
        // tsup lives in transpilers/package.json devDependencies — knip flags it as an unlisted
        // binary at root scope because it can't trace cross-workspace exec paths.
        "tsup",
    ],
};

export default config;
