/**
 * User-facing message helpers.
 *
 * Wraps LSP showMessage methods to automatically decode file:// URIs
 * into human-readable paths before display. All user-visible messages
 * should use these helpers instead of connection.window.show*Message()
 * directly — enforced via ESLint no-restricted-syntax rule.
 */

import { fileURLToPath } from "node:url";
import type { MessageActionItem } from "vscode-languageserver/node";
import { getConnection } from "./lsp-connection";

/** Regex matching file:// URIs (percent-encoded or plain). */
const FILE_URI_RE = /file:\/\/\/[^\s)'"]+/g;

/**
 * Decode all file:// URIs in a string to native OS file paths.
 * Uses fileURLToPath for correct platform-specific separators
 * (backslashes on Windows, forward slashes on Unix).
 */
export function decodeFileUris(message: string): string {
    return message.replace(FILE_URI_RE, (uri) => {
        try {
            return fileURLToPath(uri);
        } catch {
            return uri;
        }
    });
}

export function showInfo(message: string): void {
    getConnection().window.showInformationMessage(decodeFileUris(message));
}

export function showWarning(message: string): void {
    getConnection().window.showWarningMessage(decodeFileUris(message));
}

export function showError(message: string): void {
    getConnection().window.showErrorMessage(decodeFileUris(message));
}

/**
 * Show an error message with action items (e.g., "Retry" / "Cancel").
 * Returns the selected action or undefined if dismissed.
 */
export function showErrorWithActions<T extends MessageActionItem>(
    message: string,
    ...actions: T[]
): Thenable<T | undefined> {
    return getConnection().window.showErrorMessage(decodeFileUris(message), ...actions);
}
