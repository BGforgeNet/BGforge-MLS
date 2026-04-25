/** LSP-shape full-document edit helper. */

import { TextEdit } from "vscode-languageserver/node";

/**
 * Creates a TextEdit that replaces the entire document.
 */
export function createFullDocumentEdit(originalText: string, newText: string): TextEdit[] {
    const lines = originalText.split("\n");
    const lastLine = lines[lines.length - 1] ?? "";

    return [
        TextEdit.replace(
            {
                start: { line: 0, character: 0 },
                end: { line: lines.length - 1, character: lastLine.length },
            },
            newText,
        ),
    ];
}
