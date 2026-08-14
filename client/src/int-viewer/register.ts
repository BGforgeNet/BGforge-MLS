/**
 * Opens a compiled Fallout script as readable SSL.
 *
 * A `.int` is bytecode, so an editor shows it as binary and nothing in the extension could read it.
 * Decompiling it into a virtual document costs no disk write, cannot be edited into an inconsistent
 * state, and arrives as `fallout-ssl` - so highlighting, folding, outline and search all come from the
 * language support that already exists rather than from anything written here.
 *
 * When a file cannot be structured back into source the fallback is an instruction listing rather than
 * an error: a listing is always derivable, and showing one is more useful than refusing to open the
 * file. It is emitted as comments so the document stays valid SSL instead of rendering as broken code.
 */

import * as fs from "fs";
import * as vscode from "vscode";
import { decompileToProgram } from "../../../compilers/ssl/src/int/decompile";
import { printProgram } from "../../../compilers/ssl/src/int/print";
import { formatDisassembly } from "../../../compilers/ssl/src/int/disasm";
import { readInt } from "../../../compilers/ssl/src/int/read";
import { conlog } from "../logging";

export const INT_SCHEME = "bgforge-int";
export const COMMAND_DECOMPILE_INT = "bgforge.decompileInt";

/** The virtual document for a compiled script, named so the tab reads as source. */
function viewUri(source: vscode.Uri): vscode.Uri {
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
            "// The instruction listing follows. Scripts built with optimisation enabled reach this",
            "// path, since the shapes an optimiser produces no longer correspond to source constructs.",
            "",
            listing,
            "",
        ].join("\n");
    }
}

class IntContentProvider implements vscode.TextDocumentContentProvider {
    private readonly changed = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this.changed.event;

    provideTextDocumentContent(uri: vscode.Uri): string {
        return render(sourcePath(uri));
    }

    /** Re-runs the decompiler for an already-open view, so a rebuilt script shows its new contents. */
    refresh(uri: vscode.Uri): void {
        this.changed.fire(uri);
    }
}

/**
 * What to decompile: the explorer's selection when invoked from its menu, otherwise whatever the
 * active tab holds. The active TEXT editor is the last resort rather than the first, because an editor
 * showing a compiled script has no text document at all - the file is binary, so the palette would
 * otherwise never find the very file it is offered for.
 */
function resolveTarget(target: vscode.Uri | undefined): vscode.Uri | undefined {
    if (target) return target;
    const input: unknown = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    if (input && typeof input === "object" && "uri" in input && input.uri instanceof vscode.Uri) return input.uri;
    return vscode.window.activeTextEditor?.document.uri;
}

async function openDecompiled(provider: IntContentProvider, target: vscode.Uri | undefined): Promise<void> {
    const source = resolveTarget(target);
    if (!source || source.scheme !== "file") {
        void vscode.window.showInformationMessage("Select a compiled .int script to decompile.");
        return;
    }
    const uri = viewUri(source);
    provider.refresh(uri);
    try {
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.languages.setTextDocumentLanguage(document, "fallout-ssl");
        await vscode.window.showTextDocument(document, { preview: false });
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Could not open ${source.fsPath}: ${reason}`);
    }
}

export function registerIntViewer(): vscode.Disposable {
    const provider = new IntContentProvider();
    return vscode.Disposable.from(
        vscode.workspace.registerTextDocumentContentProvider(INT_SCHEME, provider),
        vscode.commands.registerCommand(COMMAND_DECOMPILE_INT, (target?: vscode.Uri) =>
            openDecompiled(provider, target),
        ),
    );
}
