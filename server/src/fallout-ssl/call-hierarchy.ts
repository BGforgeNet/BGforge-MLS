/**
 * Fallout SSL call hierarchy. A "callable" is a procedure OR a code macro. A procedure is reached in
 * several ways - a `call` statement (`call foo;`), an expression-form call (`x = foo(y);`), a proc-ref
 * (`@foo`), and - the dominant form in real dialog scripts - a bare identifier argument to a
 * dialog-option macro (`NOption(msg, TargetNode, r)`). Rather than enumerate syntactic positions, an
 * identifier is a callable reference iff it RESOLVES to a callable definition (via the same resolver
 * Go-to-Definition uses). That subsumes every form and honors variable shadowing.
 *
 * A macro (`#define`) is a callable when it is CODE, not a constant: it has parameters, or its body
 * invokes a function/procedure/macro. A parameter-less macro that invokes things is callable (standard
 * C-preprocessor behavior); a plain value (`#define MAX_HP 100`) is not, so constants stay out of the
 * graph. This maps the resulting call graph onto the LSP call-hierarchy protocol:
 *
 *   - prepare: cursor on a callable definition OR a reference -> the callable's CallHierarchyItem
 *     (always anchored at the DEFINITION, resolving a reference to its def).
 *   - outgoing: the callable references inside a body, each resolved to its callee's definition.
 *   - incoming: every reference to the callable across the workspace, grouped by the enclosing caller.
 *
 * Cross-file resolution and file reading are injected (DefLookup / TextLookup) so this stays a pure,
 * testable transform - the provider supplies the workspace index (procedures and parameterized macros)
 * and disk/open-doc reads. A parameter-less code macro defined in ANOTHER file is a known cross-file
 * gap: the index records it as a constant, so only its same-file references resolve.
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
import { parseWithCache, isInitialized } from "../../../shared/parsers/fallout-ssl";
import { SyntaxType } from "./syntax-type";
import { extractProcedures, findIdentifierNodeAtPosition, findMacroDefinition, makeRange } from "./utils";
import { sslMapGet } from "../../../shared/fallout-ssl-names";
import { resolveIdentifierDefinitionNode } from "./symbol-definitions";

/** Resolve a callable name to its definition Location across the workspace (null if unknown). */
export type DefLookup = (name: string) => Location | null;
/** Read a file's text by uri (null if unavailable). */
export type TextLookup = (uri: string) => string | null;

/** Node types that represent invoking a function/procedure/macro - what makes a macro body "code". */
const INVOCATION_TYPES: ReadonlySet<SyntaxType> = new Set([
    SyntaxType.CallExpr,
    SyntaxType.CallStmt,
    SyntaxType.MacroCallStmt,
    SyntaxType.ProcRef,
]);

/** Walk every descendant of `node` (inclusive), calling `fn` on each. */
function walk(node: SyntaxNode, fn: (n: SyntaxNode) => void): void {
    fn(node);
    for (const child of node.children) walk(child, fn);
}

/** Whether a `#define` is a code macro (callable): it has parameters, or its body invokes something. */
function isCallableMacro(defineNode: SyntaxNode): boolean {
    if (defineNode.childForFieldName("params")) return true;
    const body = defineNode.childForFieldName("body");
    if (!body) return false;
    let invokes = false;
    walk(body, (n) => {
        if (INVOCATION_TYPES.has(n.type as SyntaxType)) invokes = true;
    });
    return invokes;
}

/** Whether a definition node (procedure, forward, or `#define`) is a callable. */
function isCallableDefNode(defNode: SyntaxNode): boolean {
    if (defNode.type === SyntaxType.Procedure || defNode.type === SyntaxType.ProcedureForward) return true;
    return defNode.type === SyntaxType.Define && isCallableMacro(defNode);
}

/** Whether a resolved definition-NAME node names a callable (procedure or code macro). */
function isCallableDef(defNameNode: SyntaxNode): boolean {
    const parent = defNameNode.parent;
    return parent !== null && isCallableDefNode(parent);
}

/** Whether `idNode` is the `name` token of a callable definition (procedure, forward, or code macro). */
function isCallableDefName(idNode: SyntaxNode): boolean {
    const parent = idNode.parent;
    if (!parent || !isCallableDefNode(parent)) return false;
    return parent.childForFieldName("name")?.id === idNode.id;
}

/**
 * Whether `idNode` is a reference to a callable, in any position (`call foo`, `foo(y)`, `@foo`, a bare
 * macro argument naming a procedure, or a macro invocation). Resolution honors shadowing - an
 * identifier resolving to a same-named local variable/parameter or a constant is not a callable
 * reference. Excludes a callable's own declaration name. A name not defined in `root` is confirmed as a
 * callable via `crossFileDef`.
 */
function referencesCallable(idNode: SyntaxNode, root: SyntaxNode, crossFileDef: DefLookup): boolean {
    if (isCallableDefName(idNode)) return false;
    const def = resolveIdentifierDefinitionNode(root, idNode);
    if (def) return isCallableDef(def);
    return crossFileDef(idNode.text) !== null;
}

/** Whether `idNode` resolves to a NON-callable definition in `root` (a local var/param, or a constant). */
function isShadowedByNonCallable(idNode: SyntaxNode, root: SyntaxNode): boolean {
    const def = resolveIdentifierDefinitionNode(root, idNode);
    return def !== null && !isCallableDef(def);
}

/** The callable definition node named `name` in `root`: a procedure, or a callable macro. */
function findCallableDefNode(root: SyntaxNode, name: string): SyntaxNode | null {
    // Procedure lookup folds case, as SSL binds it; the macro lookup below stays exact, as the preprocessor
    // resolves that one.
    const proc = sslMapGet(extractProcedures(root), name);
    if (proc) return proc.node;
    const macro = findMacroDefinition(root, name);
    return macro && isCallableMacro(macro) ? macro : null;
}

/** Build a CallHierarchyItem from a callable definition node (range = whole node, selection = name). */
function itemFromDefNode(defNode: SyntaxNode, uri: string): CallHierarchyItem | null {
    const nameNode = defNode.childForFieldName("name");
    if (!nameNode) return null;
    return {
        name: nameNode.text,
        kind: defNode.type === SyntaxType.Define ? SymbolKind.Method : SymbolKind.Function,
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

/** Resolve a callable name to a CallHierarchyItem: same-file def first, then the injected cross-file lookup. */
function resolveCallable(
    name: string,
    root: SyntaxNode,
    uri: string,
    crossFileDef: DefLookup,
): CallHierarchyItem | null {
    const local = findCallableDefNode(root, name);
    if (local) return itemFromDefNode(local, uri);
    const loc = crossFileDef(name);
    return loc ? itemFromLocation(name, loc) : null;
}

/**
 * prepareCallHierarchy: resolve the callable at the cursor (a definition name OR a reference) to the
 * callable's item, always anchored at its DEFINITION. Returns null when the cursor is not on a callable
 * name or the name does not resolve to a callable (a builtin, a constant, a variable).
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

    const idNode = findIdentifierNodeAtPosition(tree.rootNode, position);
    if (!idNode) return null;
    if (!isCallableDefName(idNode) && !referencesCallable(idNode, tree.rootNode, crossFileDef)) return null;

    const item = resolveCallable(idNode.text, tree.rootNode, uri, crossFileDef);
    return item ? [item] : null;
}

/**
 * outgoingCalls: every callable reference inside the callable's body, grouped by resolved callee, with
 * `fromRanges` = the reference-name ranges within this body. Names that do not resolve to a callable
 * (builtins, constants, variables) are skipped.
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

    const defNode = findCallableDefNode(tree.rootNode, item.name);
    if (!defNode) return [];

    const byCallee = new Map<string, { to: CallHierarchyItem | null; ranges: Range[] }>();
    walk(defNode, (n) => {
        if (n.type !== SyntaxType.Identifier || !referencesCallable(n, tree.rootNode, crossFileDef)) return;
        const calleeName = n.text;
        let entry = byCallee.get(calleeName);
        if (!entry) {
            entry = { to: resolveCallable(calleeName, tree.rootNode, item.uri, crossFileDef), ranges: [] };
            byCallee.set(calleeName, entry);
        }
        entry.ranges.push(makeRange(n));
    });

    const results: CallHierarchyOutgoingCall[] = [];
    for (const { to, ranges } of byCallee.values()) {
        if (to) results.push({ to, fromRanges: ranges });
    }
    return results;
}

const ZERO_RANGE: Range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };

/** Last path segment of a file uri, for attributing a reference that sits outside any callable. */
function fileName(uri: string): string {
    const path = uri.split(/[?#]/, 1)[0]!;
    const seg = path.split("/").pop();
    return seg ? decodeURIComponent(seg) : uri;
}

/** The nearest enclosing callable (procedure or code macro) of `node`, or null. */
function findContainingCallable(node: SyntaxNode): SyntaxNode | null {
    for (let cur = node.parent; cur; cur = cur.parent) {
        if (isCallableDefNode(cur)) return cur;
    }
    return null;
}

/** The caller a reference belongs to: enclosing callable (procedure or macro), else the file. */
function callerItem(refNode: SyntaxNode, uri: string): CallHierarchyItem {
    const defNode = findContainingCallable(refNode);
    if (defNode) {
        const item = itemFromDefNode(defNode, uri);
        if (item) return item;
    }
    // A reference outside any callable (defensive - SSL executable code lives in procedures/macros).
    return { name: fileName(uri), kind: SymbolKind.File, uri, range: ZERO_RANGE, selectionRange: ZERO_RANGE };
}

/**
 * incomingCalls: every reference to `item.name` across the workspace, grouped by its enclosing caller
 * (the containing callable, else the file). `refLocations` is `refs.lookup(item.name)` - it carries
 * both the definition and reference occurrences, so the definition name and any same-named local that
 * shadows the callable are filtered out here (occurrences resolving to the callable are kept).
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
        const idNode = findIdentifierNodeAtPosition(tree.rootNode, loc.range.start);
        if (!idNode || idNode.text !== item.name) continue;
        // Keep genuine references: drop the definition name and any same-named local/constant that
        // shadows the callable. A name not defined in this file is a reference to the (cross-file)
        // callable - kept.
        if (isCallableDefName(idNode) || isShadowedByNonCallable(idNode, tree.rootNode)) continue;

        const from = callerItem(idNode, loc.uri);
        const key = `${from.uri} ${from.name} ${from.range.start.line}:${from.range.start.character}`;
        let entry = byCaller.get(key);
        if (!entry) {
            entry = { from, ranges: [] };
            byCaller.set(key, entry);
        }
        entry.ranges.push(makeRange(idNode));
    }

    return [...byCaller.values()].map(({ from, ranges }) => ({ from, fromRanges: ranges }));
}
