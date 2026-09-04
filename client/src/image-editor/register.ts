import * as vscode from "vscode";
import type { GameResourceBytes } from "./document";
import { ImageEditorProvider, type CreatureColorSource } from "./provider";

/**
 * Register the FRM/BAM animation custom editor. `resourceBytes` lets a BAM v2 resolve PVRZ pages
 * out of the open game when they do not sit beside the opened file; `creatureColors` lets an IE
 * creature animation be drawn in a real creature's colours rather than its placeholder ones.
 */
export function registerImageEditor(
    context: vscode.ExtensionContext,
    resourceBytes?: GameResourceBytes,
    creatureColors?: CreatureColorSource,
): vscode.Disposable {
    const provider = new ImageEditorProvider(context, resourceBytes, creatureColors);
    return vscode.window.registerCustomEditorProvider(ImageEditorProvider.viewType, provider, {
        supportsMultipleEditorsPerDocument: true,
        webviewOptions: { retainContextWhenHidden: true },
    });
}
