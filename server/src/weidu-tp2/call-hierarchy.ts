/**
 * WeiDU TP2 call hierarchy. TP2 has named `DEFINE_*_FUNCTION`/macro definitions and `LAF`/`LPF`
 * launches, so a real caller<->callee graph exists (dense in real installers). This maps that graph
 * onto the LSP call-hierarchy protocol:
 *
 *   - prepare: cursor on a definition OR a launch -> the function's CallHierarchyItem (always built
 *     from the DEFINITION, resolving a launch to its def).
 *   - outgoing: the launches inside a function's body, each resolved to its callee's definition.
 *   - incoming: every launch of a function across the workspace, grouped by the enclosing caller.
 *
 * Cross-file resolution and file reading are injected (DefLookup / TextLookup) so this stays a pure,
 * testable transform - the provider supplies the workspace index and disk/open-doc reads.
 */

import {
    type CallHierarchyItem,
    type CallHierarchyIncomingCall,
    type CallHierarchyOutgoingCall,
    type Location,
    type Position,
    type Range,
    SymbolKind,
} from "vscode-languageserver/node";
import type { Node as SyntaxNode } from "web-tree-sitter";
import { parseWithCache, isInitialized } from "../../../shared/parsers/weidu-tp2";
import { makeRange } from "../core/position-utils";
import { SyntaxType } from "./syntax-type";
import { FUNCTION_DEF_TYPES } from "./variable-symbols";
import { FUNCTION_CALL_TYPES } from "./callable-symbols";
import { findAncestorOfType, findNodeAtPosition, stripStringDelimiters } from "./tree-utils";

/** Resolve a callable name to its definition Location across the workspace (null if unknown). */
export type DefLookup = (name: string) => Location | null;
/** Read a file's text by uri (null if unavailable). */
export type TextLookup = (uri: string) => string | null;

const COMPONENT_TYPES: ReadonlySet<SyntaxType> = new Set([SyntaxType.Component]);
/** Def or launch nodes - the INNERMOST of these that encloses the cursor names the callable it is on. */
const CALLABLE_CONTAINER_TYPES: ReadonlySet<SyntaxType> = new Set([...FUNCTION_DEF_TYPES, ...FUNCTION_CALL_TYPES]);

/** Find a top-level function/macro definition in `root` by exact name (TP2 names are case-sensitive). */
function findTopLevelDefByName(root: SyntaxNode, name: string): SyntaxNode | null {
    for (let i = 0; i < root.childCount; i++) {
        const node = root.child(i);
        if (!node || !FUNCTION_DEF_TYPES.has(node.type as SyntaxType)) continue;
        const nameNode = node.childForFieldName("name");
        if (nameNode && stripStringDelimiters(nameNode.text) === name) return node;
    }
    return null;
}

/** Build a CallHierarchyItem from a resolved definition node (range = whole block, selection = name). */
function itemFromDefNode(defNode: SyntaxNode, uri: string): CallHierarchyItem | null {
    const nameNode = defNode.childForFieldName("name");
    if (!nameNode) return null;
    return {
        name: stripStringDelimiters(nameNode.text),
        kind: SymbolKind.Function,
        uri,
        range: makeRange(defNode),
        selectionRange: makeRange(nameNode),
    };
}

/** Build a CallHierarchyItem from a bare name + definition Location (used for cross-file targets). */
function itemFromLocation(name: string, location: Location): CallHierarchyItem {
    return {
        name,
        kind: SymbolKind.Function,
        uri: location.uri,
        range: location.range,
        selectionRange: location.range,
    };
}

/** Walk every descendant of `node` (inclusive), calling `fn` on each. */
function walk(node: SyntaxNode, fn: (n: SyntaxNode) => void): void {
    fn(node);
    for (const child of node.children) walk(child, fn);
}

/** Resolve a callee name to a CallHierarchyItem: same-file def first, then the injected cross-file lookup. */
function resolveCallee(name: string, root: SyntaxNode, uri: string, crossFileDef: DefLookup): CallHierarchyItem | null {
    const localDef = findTopLevelDefByName(root, name);
    if (localDef) return itemFromDefNode(localDef, uri);
    const loc = crossFileDef(name);
    return loc ? itemFromLocation(name, loc) : null;
}

/**
 * prepareCallHierarchy: resolve the callable at the cursor (a definition name OR a launch name) to the
 * function's item, always anchored at its DEFINITION. Returns null when the cursor is not on a callable
 * or the target has no resolvable definition (launched-but-undefined, or defined outside the workspace).
 */
export function prepareCallHierarchy(
    text: string,
    position: Position,
    uri: string,
    crossFileDef: DefLookup,
): CallHierarchyItem[] | null {
    if (!isInitialized()) return null;
    const tree = parseWithCache(text);
    if (!tree) return null;

    const node = findNodeAtPosition(tree.rootNode, position);
    if (!node) return null;

    // The cursor must sit on a definition name or a launch name. A launch inside a function body has
    // BOTH a launch and an enclosing-def ancestor, so take the INNERMOST def-or-launch container - that
    // is the one whose name the cursor is actually on.
    const container = findAncestorOfType(node, CALLABLE_CONTAINER_TYPES);
    if (!container) return null;
    const nameNode = container.childForFieldName("name");
    if (!nameNode) return null;
    // Only when the cursor is actually on the name token, not elsewhere in the def/launch.
    if (node.startIndex < nameNode.startIndex || node.endIndex > nameNode.endIndex) return null;
    const name = stripStringDelimiters(nameNode.text);

    const item = resolveCallee(name, tree.rootNode, uri, crossFileDef);
    return item ? [item] : null;
}

/**
 * outgoingCalls: every `LAF`/`LPF` launch inside the function's body, grouped by resolved callee, with
 * `fromRanges` = the launch-name ranges within this body. Callees that do not resolve to a workspace
 * definition are skipped.
 */
export function outgoingCalls(
    item: CallHierarchyItem,
    getText: TextLookup,
    crossFileDef: DefLookup,
): CallHierarchyOutgoingCall[] {
    if (!isInitialized()) return [];
    const text = getText(item.uri);
    if (!text) return [];
    const tree = parseWithCache(text);
    if (!tree) return [];

    const defNode = findTopLevelDefByName(tree.rootNode, item.name);
    if (!defNode) return [];

    const byCallee = new Map<string, { to: CallHierarchyItem | null; ranges: Range[] }>();
    walk(defNode, (n) => {
        if (!FUNCTION_CALL_TYPES.has(n.type as SyntaxType)) return;
        const nameNode = n.childForFieldName("name");
        if (!nameNode) return;
        const calleeName = stripStringDelimiters(nameNode.text);
        let entry = byCallee.get(calleeName);
        if (!entry) {
            entry = { to: resolveCallee(calleeName, tree.rootNode, item.uri, crossFileDef), ranges: [] };
            byCallee.set(calleeName, entry);
        }
        entry.ranges.push(makeRange(nameNode));
    });

    const results: CallHierarchyOutgoingCall[] = [];
    for (const { to, ranges } of byCallee.values()) {
        if (to) results.push({ to, fromRanges: ranges });
    }
    return results;
}

const ZERO_RANGE: Range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };

/** Last path segment of a file uri, for attributing a top-level launch to its file. */
function fileName(uri: string): string {
    const path = uri.split(/[?#]/, 1)[0]!;
    const seg = path.split("/").pop();
    return seg ? decodeURIComponent(seg) : uri;
}

/** The caller a launch node belongs to: enclosing function def, else enclosing component, else the file. */
function callerItem(callNode: SyntaxNode, uri: string): CallHierarchyItem {
    const defNode = findAncestorOfType(callNode, FUNCTION_DEF_TYPES);
    if (defNode) {
        const item = itemFromDefNode(defNode, uri);
        if (item) return item;
    }
    const component = findAncestorOfType(callNode, COMPONENT_TYPES);
    if (component) {
        const nameNode = component.childForFieldName("name");
        return {
            name: nameNode ? stripStringDelimiters(nameNode.text) : "component",
            kind: SymbolKind.Module,
            uri,
            range: makeRange(component),
            selectionRange: makeRange(nameNode ?? component),
        };
    }
    // A launch sitting at top level, outside any function or component - attribute it to the file.
    return { name: fileName(uri), kind: SymbolKind.File, uri, range: ZERO_RANGE, selectionRange: ZERO_RANGE };
}

/**
 * incomingCalls: every launch of `item.name` across the workspace, grouped by its enclosing caller
 * (the containing DEFINE_*_FUNCTION, else the containing component, else the file). `refLocations` is
 * `refs.lookup(item.name)` - it carries both definition and launch occurrences, so def-name occurrences
 * and same-named launches of a DIFFERENT callable are filtered out here.
 */
export function incomingCalls(
    item: CallHierarchyItem,
    refLocations: readonly Location[],
    getText: TextLookup,
): CallHierarchyIncomingCall[] {
    if (!isInitialized()) return [];

    const byCaller = new Map<string, { from: CallHierarchyItem; ranges: Range[] }>();
    for (const loc of refLocations) {
        const text = getText(loc.uri);
        if (!text) continue;
        const tree = parseWithCache(text);
        if (!tree) continue;
        const node = findNodeAtPosition(tree.rootNode, loc.range.start);
        if (!node) continue;

        // Keep only launch sites of THIS function - drop the definition occurrence and any same-named
        // reference that is not a LAF/LPF of item.name.
        const callNode = findAncestorOfType(node, FUNCTION_CALL_TYPES);
        if (!callNode) continue;
        const launchName = callNode.childForFieldName("name");
        if (!launchName || stripStringDelimiters(launchName.text) !== item.name) continue;

        const from = callerItem(callNode, loc.uri);
        const key = `${from.uri}\0${from.name}\0${from.range.start.line}:${from.range.start.character}`;
        let entry = byCaller.get(key);
        if (!entry) {
            entry = { from, ranges: [] };
            byCaller.set(key, entry);
        }
        entry.ranges.push(makeRange(launchName));
    }

    return [...byCaller.values()].map(({ from, ranges }) => ({ from, fromRanges: ranges }));
}
