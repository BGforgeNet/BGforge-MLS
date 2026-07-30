/**
 * Which editor a resource opened from an Infinity Engine game goes to.
 *
 * Its own module so it is testable without the vscode-heavy registration around it, and so the `.pro`
 * exclusion below has somewhere to be pinned - it looks like an oversight and is the opposite.
 */

/**
 * The Infinity Engine formats the binary editor can parse. Everything else a game ships opens in the ordinary
 * editor: correct for a format with no parser (BCS, DLG), and REQUIRED for `.pro`.
 *
 * `.pro` is the trap. The parser registry is keyed by extension alone, and the two game families collide on
 * that one: a Fallout `.pro` is a PROTOTYPE, an Infinity Engine `.pro` is a PROJECTILE. Asking the registry
 * "do you handle .pro?" answers yes - about the Fallout reader - so every IE projectile was routed into it and
 * failed with "Unknown object type". Do not add `pro` here, and do not restore a registry lookup in its place,
 * until the registry can say WHICH family a parser serves.
 */
export const IE_BINARY_EDITOR_EXTENSIONS: ReadonlySet<string> = new Set(["itm", "spl", "eff", "cre"]);

/**
 * The custom-editor view a game resource opens with - always named explicitly, never left to file association.
 * The binary editor is registered for `*.pro` at DEFAULT priority, so a plain `vscode.open` resolves a `.pro`
 * to it regardless of what this decided; naming the built-in `"default"` view is what actually pins the other
 * formats to the ordinary editor.
 */
export function viewTypeForResource(ext: string): string {
    return IE_BINARY_EDITOR_EXTENSIONS.has(ext.toLowerCase()) ? "bgforge.binaryEditor" : "default";
}
