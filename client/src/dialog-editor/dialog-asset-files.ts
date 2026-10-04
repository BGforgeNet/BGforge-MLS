/**
 * The files the dialog webview's host posts to it after "ready" (webview-host-html.ts `postDialogAssets`):
 * where each comes from in the client's dependencies, and its name in the output directory. scripts/build-webviews
 * .mjs copies them, and cannot import this module, so client/test/dialog-webview-bundle.test.ts pins the two
 * together.
 */
export const DIALOG_ASSET_DIR = "client/out/dialog-editor/webview";

export const DIALOG_ASSET_FILES = {
    elkWorker: { from: "elkjs/lib/elk-worker.min.js", to: "elk-worker.js" },
    onigWasm: { from: "vscode-oniguruma/release/onig.wasm", to: "onig.wasm" },
} as const;
