/**
 * The text side of a compiled Fallout script: which URI stands for it, and what it reads as.
 *
 * A `.int` is bytecode, so an editor shows it as binary and nothing in the extension could read it.
 * Decompiling it into a document named `<source>.ssl` means the tab reads as source and every language
 * feature keyed on the extension - highlighting, folding, brackets, snippets - comes from the support
 * that already exists rather than from anything written here.
 *
 * When a source cannot be structured back into source the fallback is an instruction listing rather than
 * an error: a listing is always derivable, and showing one is more useful than refusing to open the
 * file. It is emitted as comments so the document stays valid SSL instead of rendering as broken code.
 * Such a document cannot be saved back - the listing describes the code, it is not the code - and the
 * filesystem provider refuses the write rather than compiling the comments into an empty script.
 *
 * The source is read through `vscode.workspace.fs`, not a bare fs path: a `.int` opened from the game-resource
 * tree lives inside a BIF, and `workspace.fs` is what routes the read to the provider that can serve it.
 */

import * as vscode from "vscode";
import { decompileToProgram } from "../../../compilers/ssl/src/int/decompile";
import { printProgram } from "../../../compilers/ssl/src/int/print";
import { formatDisassembly } from "../../../compilers/ssl/src/int/disasm";
import { readInt } from "../../../compilers/ssl/src/int/read";
import { conlog } from "../logging";

/** Marks a rendering that is a listing rather than source, so a save can be refused with the reason. */
export const LISTING_MARKER = "// This is a disassembly listing, not source, and cannot be saved back.";

/** The document body for a compiled script: its source, or a listing when that cannot be recovered. */
export async function render(source: vscode.Uri): Promise<string> {
    const bytes = await vscode.workspace.fs.readFile(source);
    try {
        return printProgram(decompileToProgram(bytes), { origin: source.fsPath });
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        conlog(`decompiling ${source.fsPath} fell back to a listing: ${reason}`, "debug");
        const listing = formatDisassembly(readInt(bytes))
            .split("\n")
            .map((line) => `// ${line}`)
            .join("\n");
        return [
            `// ${source.fsPath} could not be reconstructed as source: ${reason}`,
            LISTING_MARKER,
            "// The instruction listing follows.",
            "",
            listing,
            "",
        ].join("\n");
    }
}
