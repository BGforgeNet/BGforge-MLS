/**
 * Which editor a resource opened from an Infinity Engine game goes to.
 *
 * Its own module so it is testable without the vscode-heavy registration around it.
 */

import { formatAdapterRegistry, parserRegistry } from "@bgforge/binary";

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
    const parser = parserRegistry.getByExtension(ext, "infinity-engine");
    if (!parser) return false;
    // A parser alone is not enough: the binary editor renders a format through its declarative `layout`, and a
    // result with no matching layout reaches the webview's error banner rather than a form. DLG is the case
    // that forced this - it parses as an IE record but is authored in the dialog editor's graph, so its
    // adapter declares no layout on purpose. Asking for the layout keeps the "a new parser routes itself"
    // property for formats the binary editor can actually draw.
    return formatAdapterRegistry.get(parser.id)?.layout !== undefined;
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
 * Formats VS Code's own bundled previewers read, mapped to the view that reads them. These need naming for the
 * same reason ours do, and for a reason that is easy to miss: `"default"` is documented as the plain TEXT
 * editor, not "pick a suitable editor", so a portrait routed there renders as bytes even though the image
 * preview claims `.bmp` at builtin priority and would have shown it.
 *
 * Only the formats a game archive actually serves are listed; the previewers cover more.
 */
const BUILTIN_VIEWS = new Map([
    ["bmp", "imagePreview.previewEditor"],
    ["wav", "vscode.audioPreview"],
]);

/**
 * The custom-editor view a game resource opens with - always named explicitly, never left to file association.
 * The binary editor is registered for `*.pro` at DEFAULT priority, so a plain `vscode.open` resolves a `.pro`
 * to it regardless of what this decided; naming a view is what actually routes a format elsewhere.
 *
 * Three sources are asked, in the order a format can only answer one of: a record goes to the binary editor, an
 * animation to the animation editor, and the rest to a bundled previewer where VS Code ships one. Asking only
 * the first sent every BAM to the text editor, which showed it as an undisplayable binary file.
 *
 * `"default"` is the last resort and means the plain TEXT editor - the right answer only for a format nothing
 * can render, which is why the previewer map above exists rather than falling through to it.
 */
export function viewTypeForResource(ext: string): string {
    if (isIeBinaryRecord(ext)) return "bgforge.binaryEditor";
    if (isIeAnimation(ext)) return "bgforge.animationEditor";
    // A compiled dialog is a graph, not a record form, so it goes to the dialog webview rather than the
    // binary editor - which is also why its adapter declares no layout for `isIeBinaryRecord` to find.
    if (ext.toLowerCase() === "dlg") return "bgforge.dlgViewer";
    return BUILTIN_VIEWS.get(ext.toLowerCase()) ?? "default";
}

/**
 * Whether opening this extension reaches an editor that can SHOW it, rather than the plain text editor - the
 * tree's "we can show you this" affordance and the binary editor's open-chip gate. Derived from the view choice
 * instead of asked separately, so the two cannot disagree about a format the way they did while this meant
 * "binary record" alone.
 *
 * Not limited to our own editors, despite where it started: a portrait opens in VS Code's image preview, which
 * answers the question just as well from a reader's point of view.
 */
export function hasViewerFor(ext: string): boolean {
    return viewTypeForResource(ext) !== "default";
}
