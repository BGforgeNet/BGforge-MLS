/**
 * Vitest configuration for client unit tests
 * (dialog tree builders, TS plugin diagnostic filtering).
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        name: "client",
        include: ["client/test/**/*.test.ts"],
        coverage: {
            provider: "v8",
            reporter: ["text", "html", "lcov"],
            exclude: [
                // VSCode extension entry point: activate/deactivate require the live vscode
                // runtime; there is no meaningful unit surface to test here.
                "client/src/extension.ts",
                // StatusBarItem wrapper that only calls vscode.window.withProgress; every
                // branch requires a live vscode runtime.
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
            thresholds: {
                lines: 90,
                functions: 90,
                branches: 80,
                statements: 90,
            },
        },
    },
});
