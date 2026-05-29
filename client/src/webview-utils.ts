/**
 * Shared helpers for the in-webview bundles (dialog-tree preview + binary
 * editor). These run in the webview's browser context, so the module must stay
 * free of Node and vscode-host APIs; esbuild inlines it into each webview
 * bundle (same as the `escapeHtml` import from `./utils`).
 */

/** Minimal view of the `acquireVsCodeApi()` handle the helpers here need. */
interface VsCodeApi {
    postMessage(message: unknown): void;
}

export interface FatalErrorHandlerOptions {
    /** The `acquireVsCodeApi()` handle, used to report the error to the host. */
    readonly vscode: VsCodeApi;
    /**
     * Human label for this webview ("Dialog preview" / "Binary editor"). Drives
     * the console prefix and the default messages for uncaught errors; the
     * lowercased form is spliced into the "Unhandled ... error" defaults.
     */
    readonly label: string;
    /** Layout-specific teardown: replace the webview body with the error detail. */
    readonly render: (detail: string) => void;
}

/**
 * Wire the webview's global `error` + `unhandledrejection` handlers to a
 * one-shot fatal-error reporter: log to the console, forward to the host as a
 * `runtimeError` message, then hand the formatted detail to `render` for the
 * caller's layout-specific teardown. Fires at most once per webview lifetime.
 */
export function installFatalErrorHandler(options: FatalErrorHandlerOptions): void {
    const { vscode, label, render } = options;
    const lower = label.toLowerCase();
    let fatalErrorShown = false;

    const showFatalError = (message: string, error?: unknown): void => {
        if (fatalErrorShown) {
            return;
        }
        fatalErrorShown = true;

        const detail = error instanceof Error ? `${message}\n${error.stack ?? error.message}` : message;
        console.error(`${label} runtime error:`, error ?? message);
        vscode.postMessage({
            type: "runtimeError",
            message,
            stack: error instanceof Error ? error.stack : undefined,
        });
        render(detail);
    };

    globalThis.addEventListener("error", (event) => {
        showFatalError(event.message || `Unhandled ${lower} error`, event.error);
    });

    globalThis.addEventListener("unhandledrejection", (event) => {
        const reason = event.reason;
        const message = reason instanceof Error ? reason.message : String(reason);
        showFatalError(message || `Unhandled ${lower} promise rejection`, reason);
    });
}
