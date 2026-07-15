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

import type { CompletionItem, Position } from "vscode-languageserver/node";
import { type IndexedSymbol, SymbolKind } from "../core/symbol";
import { Symbols } from "../core/symbol-index";
import { loadStaticSymbols } from "../core/static-loader";
import { LANG_WEIDU_BAF } from "../core/languages";
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

let bafStore: Symbols | undefined;
/** Lowercased BAF symbol name -> symbol, for case-insensitive resolution. */
let byLowerName: Map<string, IndexedSymbol> | undefined;

/** Load the BAF static vocabulary. Idempotent; called from the D provider's init(). */
export function initEmbeddedBaf(): void {
    if (bafStore) return;
    const store = new Symbols();
    store.loadStatic(loadStaticSymbols(LANG_WEIDU_BAF));
    const lower = new Map<string, IndexedSymbol>();
    for (const symbol of store.query({})) {
        lower.set(symbol.name.toLowerCase(), symbol);
    }
    bafStore = store;
    byLowerName = lower;
}

/** Case-insensitive lookup of any BAF symbol (permissive - hover explains whatever is under the cursor). */
export function resolveEmbeddedBafSymbol(name: string): IndexedSymbol | undefined {
    return byLowerName?.get(name.toLowerCase());
}

/** BAF completions scoped to the field kind (precise: triggers XOR actions; block keywords excluded). */
export function getEmbeddedBafCompletions(kind: EmbeddedBafKind): CompletionItem[] {
    if (!bafStore) return [];
    const symbolKind = kind === "trigger" ? SymbolKind.Trigger : SymbolKind.Action;
    return bafStore.query({ kinds: [symbolKind] }).map((symbol) => symbol.completion);
}
