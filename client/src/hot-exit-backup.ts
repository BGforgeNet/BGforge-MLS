import * as path from "path";
import * as vscode from "vscode";

/**
 * Hot-exit backup handling shared by the custom editors (binary, image). Each one decides what a backup
 * CONTAINS - raw bytes, a versioned container - but the failure policy and the wording the user sees are one
 * decision, so they live here rather than being restated per editor.
 */

/**
 * Tell the user their unsaved changes could not be restored, naming the file.
 *
 * A backup that cannot be read is never fatal: VS Code hands back whatever backup id it stored, which can
 * outlive the extension version that wrote it or be cleaned up underneath us, and the unsaved edits are
 * unrecoverable either way - so failing the open would lose access to the SAVED file too. Named from
 * `uri.path`, not `fsPath`, since a document can come from a virtual scheme with no filesystem path.
 */
export function warnBackupUnreadable(uri: vscode.Uri): void {
    void vscode.window.showWarningMessage(
        `Could not restore unsaved changes to ${path.basename(uri.path)}. Opened the saved file instead.`,
    );
}

/**
 * The `CustomDocumentBackup` handle for a backup already written to `destination`.
 *
 * Deleting swallows both outcomes deliberately: VS Code calls it to discard a backup it no longer needs, and a
 * delete that fails (already removed, storage gone) leaves nothing for the user to act on.
 */
export function backupHandle(destination: vscode.Uri): vscode.CustomDocumentBackup {
    return {
        id: destination.toString(),
        // The block body matters: `delete` is declared void-returning, so handing back the thenable
        // would be a promise where the host expects none.
        delete: () => {
            void vscode.workspace.fs.delete(destination).then(
                () => {},
                () => {},
            );
        },
    };
}
