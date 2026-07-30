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
 * The custom-editor view a game resource opens with - always named explicitly, never left to file association.
 * The binary editor is registered for `*.pro` at DEFAULT priority, so a plain `vscode.open` resolves a `.pro`
 * to it regardless of what this decided; naming the built-in `"default"` view is what actually pins the formats
 * we do not parse to the ordinary editor.
 */
export function viewTypeForResource(ext: string): string {
    return isIeBinaryRecord(ext) ? "bgforge.binaryEditor" : "default";
}
