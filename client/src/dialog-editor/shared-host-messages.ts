/**
 * The webview messages both dialog hosts answer identically. `panel.ts` (dialog source) and `dlg-panel.ts`
 * (compiled dialog) mount one bundle, so each of these can reach either host; answering them here is what keeps
 * one host from silently dropping a message the other shows (as "notify" and "runtimeError" once were).
 */

import * as vscode from "vscode";
import { reportSlowFrame } from "../timing";
import { surfaceWebviewRuntimeError } from "../webview-error";
import type { WebviewToHost } from "./webview/messages";

/**
 * Answer a host-independent message. `file` is the document's base name, for the log and toast.
 *
 * @returns false for a message the calling host must handle itself.
 */
export function handleSharedDialogMessage(msg: WebviewToHost, file: string): boolean {
    switch (msg.type) {
        // A user-facing notice (e.g. Del pressed on a non-deletable node): shown as a notification so a blocked
        // action explains itself instead of silently doing nothing.
        case "notify":
            if (msg.level === "warn") void vscode.window.showWarningMessage(msg.text);
            else void vscode.window.showInformationMessage(msg.text);
            return true;
        // A fatal error caught by the webview's installFatalErrorHandler (see webview/main.ts): reported through
        // the output channel and a toast, like the binary editor's, instead of leaving a blank panel.
        case "runtimeError":
            surfaceWebviewRuntimeError({ editor: "Dialog editor", file, message: msg.message, stack: msg.stack });
            return true;
        // The webview held its own thread long enough to stop painting (observeSlowFrames in webview-utils.ts).
        // Logged rather than shown: a toast for a stall would itself be noise on the machine already struggling.
        case "slowFrame":
            reportSlowFrame("Dialog editor", file, msg.ms);
            return true;
        default:
            return false;
    }
}
