import * as vscode from "vscode";
import { type AnimationIndexResolver, setTitle } from "@bgforge/animation";
import { animationSetUri } from "./uri";

/**
 * Show a whole animation set in the editor, by the set-scoped address that editor opens.
 *
 * Shared because two surfaces reach the same set: the gallery's open button and the editor's own set
 * picker. One of them building the address itself would be a second statement of what a set's tab is
 * called, and the two would drift on the first change to either.
 *
 * Labelled with the set's own name so the tab reads as the animation rather than as an id; an id the
 * install declares nothing for simply opens under its number.
 */
export async function openAnimationSet(animations: AnimationIndexResolver, gameDir: string, id: number): Promise<void> {
    const set = (animations(gameDir) ?? []).find((entry) => entry.id === id);
    const uri = animationSetUri(gameDir, id, set === undefined ? undefined : setTitle(set));
    await vscode.commands.executeCommand("vscode.open", uri);
}
