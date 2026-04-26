import * as vscode from "vscode";
import { conlog } from "./logging";

export interface WebviewRuntimeErrorReport {
    /** Short description of which webview produced the error (e.g. "Binary editor for foo.pro"). */
    readonly label: string;
    /** Filename to surface in the user-visible message; usually basename of the document. */
    readonly userFacingFile: string;
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
    const headline = `${report.label}: ${report.message}`;
    const stackSuffix = report.stack ? `\n${report.stack}` : "";
    console.error(headline, report.stack ?? "");
    conlog(`${headline}${stackSuffix}`, "error");
    void vscode.window.showErrorMessage(`${report.label} failed for ${report.userFacingFile}: ${report.message}`);
}
