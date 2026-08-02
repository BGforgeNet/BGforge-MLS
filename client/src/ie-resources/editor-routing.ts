/**
 * Which editor a resource opened from an Infinity Engine game goes to.
 *
 * Its own module so it is testable without the vscode-heavy registration around it.
 */

import { parserRegistry } from "@bgforge/binary";

/**
 * Whether the binary editor can read this extension AS AN INFINITY ENGINE RECORD - the one question both the
 * tree's affordance and the view choice below are decided by, so they cannot drift apart.
 *
 * The family is the whole point of asking. `.pro` is a Fallout PROTOTYPE to the parser registry and an Infinity
 * Engine PROJECTILE here; a family-blind lookup answers yes about the Fallout reader, which is what routed every
 * IE projectile into it to fail with "Unknown object type". Naming the family also means a new IE parser routes
 * itself the moment it registers, where the hand-kept extension list this replaced could silently omit it.
 */
export function isIeBinaryRecord(ext: string): boolean {
    return parserRegistry.getByExtension(ext, "infinity-engine") !== undefined;
}

/**
 * Extensions the animation editor reads that an Infinity Engine game can hold - BAM only, since FRM and the
 * `.fr0`-`.fr5` split members are Fallout formats. Deliberately the animation editor's selector intersected
 * with what a game archive serves, not a copy of it.
 */
const IE_ANIMATION_EXTENSIONS = new Set(["bam"]);

function isIeAnimation(ext: string): boolean {
    return IE_ANIMATION_EXTENSIONS.has(ext.toLowerCase());
}

/**
 * The custom-editor view a game resource opens with - always named explicitly, never left to file association.
 * The binary editor is registered for `*.pro` at DEFAULT priority, so a plain `vscode.open` resolves a `.pro`
 * to it regardless of what this decided; naming the built-in `"default"` view is what actually pins the formats
 * no editor of ours reads to the ordinary editor.
 *
 * Both editors are asked, in the order a format can only answer one of: a record goes to the binary editor, an
 * animation to the animation editor. Asking only the first sent every BAM to the text editor, which showed it
 * as an undisplayable binary file.
 */
export function viewTypeForResource(ext: string): string {
    if (isIeBinaryRecord(ext)) return "bgforge.binaryEditor";
    if (isIeAnimation(ext)) return "bgforge.animationEditor";
    return "default";
}

/**
 * Whether one of our editors opens this extension, rather than VS Code's ordinary one - the tree's
 * "we can show you this" affordance. Derived from the view choice instead of asked separately, so the
 * two cannot disagree about a format the way they did while this meant "binary record" alone.
 */
export function opensInOurEditor(ext: string): boolean {
    return viewTypeForResource(ext) !== "default";
}
