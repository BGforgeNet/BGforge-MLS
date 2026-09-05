import * as vscode from "vscode";
import type { GameResourceBytes } from "./document";
import { ImageEditorProvider, type CreatureColorSource } from "./provider";
import { type AnimationSetSource } from "./set-document";

/**
 * Register the FRM/BAM animation custom editor. `resourceBytes` lets a BAM v2 resolve PVRZ pages
 * out of the open game when they do not sit beside the opened file; `creatureColors` lets an IE
 * creature animation be drawn in a real creature's colours rather than its placeholder ones;
 * `animationSets` lets it open a whole animation set rather than one of its files, and
 * `confirmGroupWrite` asks once before a set save replaces several files in the game's override folder.
 */
export function registerImageEditor(
    context: vscode.ExtensionContext,
    resourceBytes?: GameResourceBytes,
    creatureColors?: CreatureColorSource,
    animationSets?: AnimationSetSource,
    confirmGroupWrite?: (uris: readonly vscode.Uri[]) => Promise<void>,
): vscode.Disposable {
    const provider = new ImageEditorProvider(context, resourceBytes, creatureColors, animationSets, confirmGroupWrite);
    return vscode.window.registerCustomEditorProvider(ImageEditorProvider.viewType, provider, {
        supportsMultipleEditorsPerDocument: true,
        webviewOptions: { retainContextWhenHidden: true },
    });
}
