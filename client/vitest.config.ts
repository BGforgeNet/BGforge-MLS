/**
 * Vitest configuration for client unit tests
 * (dialog tree builders, TS plugin diagnostic filtering).
 */

import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
    resolve: {
        // Map the workspace package to its source so vitest can import it
        // without requiring a build step. The built out/ does not exist until
        // pnpm --filter @bgforge/binary build runs, but tests run from source.
        alias: {
            "@bgforge/binary": path.resolve(__dirname, "../binary/src/index.ts"),
            "@bgforge/binary-editor": path.resolve(__dirname, "../binary-editor/src/index.ts"),
        },
    },
    test: {
        name: "client",
        include: ["client/test/**/*.test.ts"],
        // v8 coverage instrumentation roughly 3-4x slows the binary-format parser
        // tests in this suite; the 5s vitest default is too tight for them under
        // --coverage and was producing intermittent failures.
        testTimeout: 15000,
        coverage: {
            provider: "v8",
            reporter: ["text", "html", "lcov"],
            // Separate from the server's coverage output so the parallel
            // server+client coverage runs in scripts/test.sh don't race on
            // coverage/.tmp shard files.
            reportsDirectory: "coverage/client",
            // Maintainer-recommended workaround for the .tmp/coverage-N.json
            // ENOENT race under parallel coverage runs (vitest-dev/vitest
            // #4943, #5903). scripts/test.sh also serialises coverage jobs.
            clean: false,
            // Constrain measurement to client sources. Without this, v8 also
            // counts files loaded transitively through workspace deps
            // (@bgforge/binary), which sinks the ratio because the binary
            // package has its own test suite under binary/test/.
            include: ["client/src/**/*.ts"],
            exclude: [
                // VS Code E2E harness (electron-driven), not unit-testable.
                "client/src/test/**",
                // VSCode extension entry point: activate/deactivate require the live vscode
                // runtime; there is no meaningful unit surface to test here.
                "client/src/extension.ts",
                // Webview bundle entry points that only run inside the webview context.
                "client/src/binary-editor/webview/main.ts",
                // worker_threads entry: runs only inside a spawned worker. Its behaviour is
                // covered by the spawned-worker integration test (which bundles it through
                // esbuild and runs it out of process), not by in-process vitest coverage.
                "client/src/binary-editor/worker.ts",
                // Worker-backed binary editor host glue: the provider, document, and command
                // registration are built entirely around vscode.CustomEditorProvider,
                // vscode.WebviewPanel, and worker_threads; their behaviour is exercised by the
                // spawned-worker integration test, not by mocking the vscode runtime.
                "client/src/binary-editor/provider.ts",
                "client/src/binary-editor/document.ts",
                "client/src/binary-editor/register.ts",
                // Shared webview-context helpers (navigator/globalThis/document); like the
                // bundle entry points above, they run only inside the webview, not in vitest.
                "client/src/webview-utils.ts",
                // binary-editor/webview/messages.ts is a types-only file with no executable
                // branches; its surface is exercised transitively via the worker protocol types.
                "client/src/binary-editor/webview/messages.ts",
                // Thin wrapper over Svelte's getContext/setContext, which only work during component
                // initialisation and throw outside one; there is no non-component surface to unit-test
                // (a harness would only re-assert that Svelte stores and returns the value). Exercised
                // in-context by the components that provide/consume the jump callback.
                "client/src/binary-editor/webview/state/jump-context.ts",
                // Dialog editor: the render harness (mounts the real App in Chromium via Playwright,
                // delivers the model through the real postMessage channel) is e2e-tier and run out of
                // process, not under in-process vitest. Same category as client/src/test/**.
                "client/src/dialog-editor/test/**",
                // Dialog editor panel lifecycle: built entirely around vscode.WebviewPanel,
                // vscode.workspace, and the LanguageClient request channel - mocking them would recreate
                // the framework. Its one pure piece (HTML/CSP assembly) is extracted to
                // dialog-webview-html.ts and unit-tested (dialog-panel-html.test.ts). Mirrors the
                // binary-editor provider.ts/document.ts/register.ts exclusions.
                "client/src/dialog-editor/panel.ts",
                // Webview bundle entry + the acquireVsCodeApi host channel: run only inside the VS Code
                // webview context, not in vitest. Mirrors binary-editor/webview/main.ts and the webview
                // host helpers above.
                "client/src/dialog-editor/webview/main.ts",
                "client/src/dialog-editor/webview/host.ts",
            ],
            // Enforced as a real gate: scripts/test.sh runs this config with
            // --coverage, and vitest exits non-zero on threshold breach.
            // Floors track current coverage and may only be raised, never
            // lowered; raising them when a test bump pulls the actual numbers
            // up turns the gate into a ratchet against future regressions.
            thresholds: {
                lines: 97,
                functions: 94,
                branches: 90,
                statements: 96,
            },
        },
    },
});
