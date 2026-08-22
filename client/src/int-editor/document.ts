/**
 * The text side of a compiled Fallout script: which URI stands for it, and what it reads as.
 *
 * A `.int` is bytecode, so an editor shows it as binary and nothing in the extension could read it.
 * Decompiling it into a document named `<file>.ssl` means the tab reads as source and every language
 * feature keyed on the extension - highlighting, folding, brackets, snippets - comes from the support
 * that already exists rather than from anything written here.
 *
 * When a file cannot be structured back into source the fallback is an instruction listing rather than
 * an error: a listing is always derivable, and showing one is more useful than refusing to open the
 * file. It is emitted as comments so the document stays valid SSL instead of rendering as broken code.
 * Such a document cannot be saved back - the listing describes the code, it is not the code - and the
 * filesystem provider refuses the write rather than compiling the comments into an empty script.
 */

import * as fs from "fs";
import * as vscode from "vscode";
import { decompileToProgram } from "../../../compilers/ssl/src/int/decompile";
import { printProgram } from "../../../compilers/ssl/src/int/print";
import { formatDisassembly } from "../../../compilers/ssl/src/int/disasm";
import { readInt } from "../../../compilers/ssl/src/int/read";
import { conlog } from "../logging";

export const INT_SCHEME = "bgforge-int";

/** Marks a rendering that is a listing rather than source, so a save can be refused with the reason. */
export const LISTING_MARKER = "// This is a disassembly listing, not source, and cannot be saved back.";

/** The document for a compiled script, named so the tab reads as source. */
export function viewUri(source: vscode.Uri): vscode.Uri {
    return vscode.Uri.from({ scheme: INT_SCHEME, path: `${source.fsPath}.ssl` });
}

export function sourcePath(view: vscode.Uri): string {
    return view.path.replace(/\.ssl$/, "");
}

/** The document body for a compiled script: its source, or a listing when that cannot be recovered. */
export function render(file: string): string {
    const bytes = new Uint8Array(fs.readFileSync(file));
    try {
        return printProgram(decompileToProgram(bytes), { origin: file });
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        conlog(`decompiling ${file} fell back to a listing: ${reason}`, "debug");
        const listing = formatDisassembly(readInt(bytes))
            .split("\n")
            .map((line) => `// ${line}`)
            .join("\n");
        return [
            `// ${file} could not be reconstructed as source: ${reason}`,
            LISTING_MARKER,
            "// The instruction listing follows.",
            "",
            listing,
            "",
        ].join("\n");
    }
}
