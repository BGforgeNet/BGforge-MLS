/**
 * Vitest configuration for client unit tests
 * (dialog tree builders, TS plugin diagnostic filtering).
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        name: "client",
        include: ["client/test/**/*.test.ts"],
        // v8 coverage instrumentation roughly 3-4x slows the binary-format parser
        // tests in this suite; the 5s vitest default is too tight for them under
        // --coverage and was producing intermittent failures.
        testTimeout: 15_000,
        coverage: {
            provider: "v8",
            reporter: ["text", "html", "lcov"],
            // Separate from the server's coverage output so the parallel
            // server+client coverage runs in scripts/test.sh don't race on
            // coverage/.tmp shard files.
            reportsDirectory: "coverage/client",
            exclude: [
                // VSCode extension entry point: activate/deactivate require the live vscode
                // runtime; there is no meaningful unit surface to test here.
                "client/src/extension.ts",
                // The withProgress-driven progress UI requires a live vscode runtime;
                // unit tests in client/test/indicator.test.ts cover the timeout/reset
                // logic with a mocked vscode but cannot reach the runtime branches
                // needed to lift this file above the 90% coverage threshold.
                "client/src/indicator.ts",
                // Panel lifecycle management is built entirely around vscode.WebviewPanel,
                // vscode.workspace, and vscode.window APIs; mocking them would recreate the
                // framework rather than test behaviour.
                "client/src/dialog-tree/shared.ts",
                // Webview bundle entry points that only run inside the webview context.
                "client/src/dialog-tree/dialogTree-webview.ts",
                "client/src/editors/binaryEditor-webview*.ts",
                "client/src/editors/binaryEditor.ts",
                // editors/binaryEditor-messages.ts is a types-only file with no executable
                // branches; its surface is exercised transitively via document/tree tests.
                "client/src/editors/binaryEditor-messages.ts",
            ],
            // Enforced as a real gate: scripts/test.sh runs this config with
            // --coverage, and vitest exits non-zero on threshold breach.
            // Floors track current coverage and may only be raised, never
            // lowered; raising them when a test bump pulls the actual numbers
            // up turns the gate into a ratchet against future regressions.
            thresholds: {
                lines: 90,
                functions: 90,
                branches: 80,
                statements: 90,
            },
        },
    },
});
