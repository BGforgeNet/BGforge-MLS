/**
 * WeiDU D <-> BAF seam. `.d` dialog files embed BAF trigger/action/condition code inside `~...~` strings
 * held by grammar fields named "trigger", "action", or "condition". This module surfaces the BAF static
 * vocabulary (completion + hover) inside those embedded regions.
 *
 * BAF names are case-insensitive (WeiDU's baflexer uppercases for lookup); D state labels and tp2 vars are
 * case-sensitive. Resolution here case-folds; nothing outside an embedded region changes. Completion is
 * precise by field (trigger/condition -> triggers, action -> actions); hover is permissive (resolves any
 * BAF symbol under the cursor - explaining code, not authoring it).
 */

import type { Position } from "vscode-languageserver/node";
import { isInitialized, parseWithCache } from "../../../shared/parsers/weidu-d";
import { SyntaxType } from "./syntax-type";

/** Grammar field names whose `$.string` child holds embedded BAF code. */
const TRIGGER_FIELDS: ReadonlySet<string> = new Set(["trigger", "condition"]);
const ACTION_FIELDS: ReadonlySet<string> = new Set(["action"]);

export type EmbeddedBafKind = "trigger" | "action";

/**
 * If `position` is inside an embedded-BAF string, return which vocabulary applies: "trigger" for
 * trigger/condition fields, "action" for action fields. Otherwise null (plain D context).
 */
export function detectEmbeddedBaf(text: string, position: Position): EmbeddedBafKind | null {
    if (!isInitialized()) return null;
    const tree = parseWithCache(text);
    if (!tree) return null;

    let node = tree.rootNode.descendantForPosition({ row: position.line, column: position.character });
    // Walk up to the enclosing string node (the field child is always a `$.string`).
    while (node && node.type !== SyntaxType.String) {
        node = node.parent;
    }
    const parent = node?.parent;
    if (!node || !parent) return null;

    for (const field of TRIGGER_FIELDS) {
        if (parent.childForFieldName(field)?.id === node.id) return "trigger";
    }
    for (const field of ACTION_FIELDS) {
        if (parent.childForFieldName(field)?.id === node.id) return "action";
    }
    return null;
}
