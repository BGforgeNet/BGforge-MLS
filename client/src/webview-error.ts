import * as vscode from "vscode";
import { conlog } from "./logging";

export interface WebviewRuntimeErrorReport {
    /**
     * Which webview produced the error, named WITHOUT the document (e.g. "Binary editor").
     *
     * The file is a field of its own because each channel names it in its own place; a caller that folded it
     * into this string got it twice - "Dialog editor for x.dlg failed for x.dlg".
     */
    readonly editor: string;
    /** The document the webview was showing; usually the basename. */
    readonly file: string;
    /** Error message as reported by the webview script. */
    readonly message: string;
    /** Optional stack trace string for Developer Tools and the output channel. */
    readonly stack?: string;
}

/**
 * Surface a runtime error reported by a webview through all three operator-visible channels:
 *   - Developer Tools console (full stack)
 *   - "BGforge MLS" output channel via conlog (correlatable with extension logs)
 *   - showErrorMessage toast (user-facing)
 *
 * Without the conlog leg, webview crashes leave no trace in the channel an operator
 * is watching, even though every other extension error path lands there.
 */
export function surfaceWebviewRuntimeError(report: WebviewRuntimeErrorReport): void {
    const headline = `${report.editor} for ${report.file}: ${report.message}`;
    const stackSuffix = report.stack ? `\n${report.stack}` : "";
    console.error(headline, report.stack ?? "");
    conlog(`${headline}${stackSuffix}`, "error");
    void vscode.window.showErrorMessage(`${report.editor} failed for ${report.file}: ${report.message}`);
}

/** A message's `type`, or its JS type when it has none. */
function describeMessageType(message: unknown): string {
    if (typeof message !== "object" || message === null || !("type" in message)) return typeof message;
    return String((message as { type: unknown }).type);
}

/**
 * Report a message outside a webview's protocol. It means the webview and its host disagree about the contract,
 * which is a bug rather than input, so it is surfaced where a webview throw is - not acted on, and not dropped.
 */
export function reportUnrecognizedMessage(editor: string, file: string, message: unknown): void {
    surfaceWebviewRuntimeError({
        editor,
        file,
        message: `unrecognized message of type ${describeMessageType(message)}`,
    });
}
