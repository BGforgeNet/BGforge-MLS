import * as vscode from "vscode";
import { type AnimationIndexResolver, setTitle } from "@bgforge/animation";
import { animationSetUri } from "./uri";

/**
 * The address a whole animation set is shown by.
 *
 * Both surfaces build it here: the editor tab opens it as a document, the gallery hands it to the stage in
 * the panel it already has. Labelled with the set's own name so it reads as the animation rather than as an
 * id; an id the install declares nothing for simply resolves under its number.
 */
export function animationSetAddress(animations: AnimationIndexResolver, gameDir: string, id: number): vscode.Uri {
    const set = (animations(gameDir) ?? []).find((entry) => entry.id === id);
    return animationSetUri(gameDir, id, set === undefined ? undefined : setTitle(set));
}

/** Open a set as a TAB - the editor tab's answer to its own set picker, where the gallery draws it inline. */
export async function openAnimationSet(animations: AnimationIndexResolver, gameDir: string, id: number): Promise<void> {
    await vscode.commands.executeCommand("vscode.open", animationSetAddress(animations, gameDir, id));
}
