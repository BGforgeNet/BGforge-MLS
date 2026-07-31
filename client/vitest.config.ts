/**
 * Vitest configuration for client unit tests
 * (dialog tree builders, TS plugin diagnostic filtering).
 */

import { defineConfig } from "vitest/config";
import path from "path";
import { coverageConfig } from "../scripts/utils/src/vitest-coverage-config";

export default defineConfig({
    resolve: {
        // Map the workspace package to its source so vitest can import it
        // without requiring a build step. The built out/ does not exist until
        // pnpm --filter @bgforge/binary build runs, but tests run from source.
        alias: {
            "@bgforge/binary": path.resolve(__dirname, "../binary/src/index.ts"),
            "@bgforge/binary-editor": path.resolve(__dirname, "../binary-editor/src/index.ts"),
            // The pure subpaths must precede the barrel alias: vite matches an alias when the id starts
            // with `key + "/"`, so "@bgforge/image" would otherwise capture them and rewrite to a bad
            // path. The webview renderer imports these subpaths to avoid pulling the barrel's Node-only
            // codecs into a browser bundle.
            "@bgforge/image/frame-anchor": path.resolve(__dirname, "../image/src/model/frame-anchor.ts"),
            "@bgforge/image/ie-direction": path.resolve(__dirname, "../image/src/model/ie-direction.ts"),
            "@bgforge/image": path.resolve(__dirname, "../image/src/index.ts"),
        },
    },
    test: {
        name: "client",
        // Absolute so discovery works both from client/ and from the repo root
        // (scripts/test.sh invokes this config from root); a repo-root-relative
        // glob silently matches 0 files when run from client/.
        include: [path.resolve(__dirname, "test/**/*.test.ts")],
        // v8 coverage instrumentation roughly 3-4x slows the binary-format parser
        // tests in this suite, and the parallel coverage block in scripts/test.sh
        // saturates every core, starving this suite's worker-spawning and
        // request-correlation tests (observed 19.5s on a 15s budget). The bound
        // only limits how long a genuine hang takes to fail; green runs finish
        // in seconds regardless of the value.
        testTimeout: 60000,
        // Separate from the server's coverage output so the parallel
        // server+client coverage runs in scripts/test.sh don't race on
        // coverage/.tmp shard files.
        coverage: coverageConfig({
            reportsDirectory: "coverage/client",
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
                // Same reasoning for the animation editor: the bundle entry runs only inside the webview,
                // and bridge.ts is thin postMessage glue with no in-process test surface.
                "client/src/image-editor/webview/main.ts",
                "client/src/image-editor/webview/state/bridge.ts",
                // worker_threads entry: runs only inside a spawned worker. Its behaviour is
                // covered by the spawned-worker integration test (which bundles it through
                // esbuild and runs it out of process), not by in-process vitest coverage.
                "client/src/binary-editor/worker.ts",
                // Worker-backed binary editor host glue: the provider, document, and command registration are
                // built around vscode.CustomEditorProvider, vscode.WebviewPanel and worker_threads, so their
                // behaviour comes from the spawned-worker integration test. Excluded from the COVERAGE RATIO
                // rather than from testing: restore-backup.test.ts drives the hot-exit path here against a
                // mocked vscode, which is worth pinning but would report as thin partial coverage of files
                // whose bulk is framework wiring.
                "client/src/binary-editor/provider.ts",
                "client/src/binary-editor/document.ts",
                "client/src/binary-editor/register.ts",
                // Same reasoning for the animation (FRM/BAM) custom editor, including its own
                // restore-backup.test.ts; the rest of its pure logic already has dedicated coverage in
                // document-model.ts/sidecar.ts/save.ts/export-actions.ts.
                "client/src/image-editor/provider.ts",
                "client/src/image-editor/document.ts",
                "client/src/image-editor/register.ts",
                // IE game resource viewer: the FS provider, tree provider, and command registration are built
                // around vscode.FileSystemProvider, vscode.TreeDataProvider, and vscode.commands - mocking them
                // would recreate the framework (same reasoning as the binary/image editor exclusions above).
                // Their pure logic is extracted and unit-tested: the game session (session.ts,
                // ie-resources-session.test.ts) and the resource-URI encoding (uri.ts, ie-resources-uri.test.ts).
                "client/src/ie-resources/fs-provider.ts",
                "client/src/ie-resources/tree-provider.ts",
                "client/src/ie-resources/register.ts",
                // Shared webview-context helpers (navigator/globalThis/document); like the
                // bundle entry points above, they run only inside the webview, not in vitest.
                "client/src/webview-utils.ts",
                // binary-editor/webview/messages.ts is a types-only file with no executable
                // branches; its surface is exercised transitively via the worker protocol types.
                "client/src/binary-editor/webview/messages.ts",
                // dialog-editor/webview/dialog-actions.ts is a types-only file (one interface,
                // no executable branches) shared between DialogGraph.svelte (builder) and
                // Inspector.svelte (consumer) so their action-prop shapes cannot drift; its
                // surface is exercised transitively through those components. Same category as
                // messages.ts above.
                "client/src/dialog-editor/webview/dialog-actions.ts",
                // Thin wrapper over Svelte's getContext/setContext, which only work during component
                // initialisation and throw outside one; there is no non-component surface to unit-test
                // (a harness would only re-assert that Svelte stores and returns the value). Exercised
                // in-context by the components that provide/consume the jump callback.
                "client/src/binary-editor/webview/state/jump-context.ts",
                // Same shape and same reasoning: the open-a-referenced-resource callback wrapper. Exercised
                // in-context by OpenResourceLink and the LayoutRenderer that provides it.
                "client/src/binary-editor/webview/state/open-resource-context.ts",
                // Same shape and same reasoning again: the list-the-game's-resources callback wrapper.
                // Exercised in-context by ResourceField and the LayoutRenderer that provides it, and
                // end-to-end by the resource-picker render harness.
                "client/src/binary-editor/webview/state/resource-list-context.ts",
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
                // Svelte textarea-autosize action: its whole job is measuring laid-out DOM (scrollHeight),
                // which no in-process test environment lays out - a unit test could only re-assert its own
                // stub. Exercised by the harness drivers and the live editor. Same category as
                // jump-context.ts above.
                "client/src/dialog-editor/webview/autosize.ts",
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
        }),
    },
});
