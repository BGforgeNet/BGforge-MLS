import {
    formatAdapterRegistry,
    type ParsedField,
    type ParsedGroup,
    type ParseResult,
    type ProjectedEntry,
} from "@bgforge/binary";
import type { NamePath, NodeId } from "./types";

function isGroup(entry: ParsedField | ParsedGroup): entry is ParsedGroup {
    return Array.isArray((entry as ParsedGroup).fields);
}

export interface FlatNode {
    id: NodeId;
    namePath: NamePath;
    depth: number;
    parentId: NodeId | undefined;
    kind: "group" | "field";
    /** The source entry from the parse tree (group or field). */
    source: ParsedField | ParsedGroup;
    /** Number of direct children (0 for fields). */
    childCount: number;
    name: string;
    /** True when an ancestor group has editingLocked === true. Propagated from
     *  the parent during buildModel so field projection can mark rows non-editable
     *  without re-walking the tree at render time. */
    parentLocked?: boolean;
    /** Raw structural path (pre-projection) for this node. Identity projection makes
     *  this equal to namePath; a format's projectDisplayRoot may differ (e.g. MAP
     *  lifts objects out of "Objects Section"). Used to address bytes/semantic keys. */
    sourceSegments: readonly string[];
}

export interface Model {
    parseResult: ParseResult;
    nodes: FlatNode[];
    /** id -> index into `nodes`. */
    byId: Map<NodeId, number>;
    /** Set of group NodeIds that are currently expanded. */
    expanded: Set<NodeId>;
    /** Direct-children indices into `nodes`, keyed by parent NodeId; "" holds the depth-0 roots. */
    childrenByParent: Map<NodeId | "", number[]>;
}

/** Recursively project one raw entry, applying the adapter's hide predicates.
 *  Returns undefined when the entry is hidden. */
function projectEntry(
    adapter: ReturnType<typeof formatAdapterRegistry.get>,
    entry: ParsedField | ParsedGroup,
    sourceSegments: readonly string[],
): ProjectedEntry | undefined {
    if (isGroup(entry)) {
        if (adapter?.shouldHideGroup?.(entry)) return undefined;
        const children = entry.fields
            .map((c) => projectEntry(adapter, c, [...sourceSegments, c.name]))
            .filter((c): c is ProjectedEntry => c !== undefined);
        return { kind: "group", entry, sourceSegments, children };
    }
    if (adapter?.shouldHideField?.(entry)) return undefined;
    return { kind: "field", entry, sourceSegments };
}

/** Per-format display projection; identity (no regroup, no hiding) when the adapter
 *  declares no projectDisplayRoot, so non-projecting formats are unchanged. */
function projectRoot(parseResult: ParseResult): ProjectedEntry[] {
    const adapter = formatAdapterRegistry.get(parseResult.format);
    if (adapter?.projectDisplayRoot) {
        return adapter.projectDisplayRoot(parseResult, (_pr, entry, segs) => projectEntry(adapter, entry, segs));
    }
    return parseResult.root.fields
        .map((e) => projectEntry(adapter, e, [e.name]))
        .filter((e): e is ProjectedEntry => e !== undefined);
}

/** Pre-order flatten of the projected tree. The root group is not itself a node;
 *  its children are the depth-0 nodes. Ids are positional (`parentId/childIndex`)
 *  so they are stable for a given tree shape and unique by construction. */
export function buildModel(parseResult: ParseResult): Model {
    const nodes: FlatNode[] = [];
    const byId = new Map<NodeId, number>();
    const expanded = new Set<NodeId>();
    const childrenByParent = new Map<NodeId | "", number[]>();

    const walk = (
        entries: readonly ProjectedEntry[],
        depth: number,
        parentId: NodeId | undefined,
        parentNamePath: NamePath,
        parentLocked: boolean,
    ): void => {
        entries.forEach((pe, index) => {
            const entry = pe.entry;
            const id = parentId === undefined ? String(index) : `${parentId}/${index}`;
            const namePath: NamePath = [...parentNamePath, entry.name];
            const locked = isEntryLocked(entry, parentLocked);
            byId.set(id, nodes.length);
            const parentKey = parentId ?? "";
            const siblings = childrenByParent.get(parentKey);
            if (siblings) siblings.push(nodes.length);
            else childrenByParent.set(parentKey, [nodes.length]);
            nodes.push({
                id,
                namePath,
                depth,
                parentId,
                kind: pe.kind,
                source: entry,
                childCount: pe.kind === "group" ? pe.children.length : 0,
                name: entry.name,
                parentLocked: parentLocked || undefined,
                sourceSegments: pe.sourceSegments,
            });
            if (pe.kind === "group") walk(pe.children, depth + 1, id, namePath, locked);
        });
    };

    walk(projectRoot(parseResult), 0, undefined, [], false);
    return { parseResult, nodes, byId, expanded, childrenByParent };
}

export function setExpanded(model: Model, id: NodeId, value: boolean): void {
    if (value) model.expanded.add(id);
    else model.expanded.delete(id);
}

export function visibleNodes(model: Model): FlatNode[] {
    const out: FlatNode[] = [];
    for (const node of model.nodes) {
        if (node.parentId === undefined || isAncestorChainExpanded(model, node.parentId)) {
            out.push(node);
        }
    }
    return out;
}

function isAncestorChainExpanded(model: Model, parentId: NodeId): boolean {
    let current: NodeId | undefined = parentId;
    while (current !== undefined) {
        if (!model.expanded.has(current)) return false;
        const idx = model.byId.get(current);
        current = idx === undefined ? undefined : model.nodes[idx]?.parentId;
    }
    return true;
}

/**
 * Single source of truth for the "editing-locked" propagation rule: an entry is locked when it
 * itself carries `editingLocked === true` (only a `ParsedGroup` can) OR `ancestorLocked` is true
 * (some enclosing group up the chain already carries the flag). A parser sets `editingLocked` when
 * it could not fully decode a record (e.g. a MAP object whose subtype trailer depends on external
 * `.pro` metadata); field edits inside such a subtree are width-preserving but not
 * interpretation-preserving, so nothing under the flag may be mutated.
 *
 * `buildModel`'s pre-order walk applies this per entry during construction (`ancestorLocked` is the
 * threaded `parentLocked` flag); `isNodeLocked` below applies it again per `NodeId`, reading the SAME
 * `FlatNode.parentLocked` the walk already computed. One predicate, two call sites - a lock enforced
 * at build/display time and one enforced before a host-side mutation can never drift apart.
 */
function isEntryLocked(entry: ParsedField | ParsedGroup, ancestorLocked: boolean): boolean {
    return ancestorLocked || (isGroup(entry) && entry.editingLocked === true);
}

/** True when node `id` (or any ancestor) is editing-locked. False for an unknown id - callers that
 *  need existence validation perform their own `byId` lookup and raise their own "unknown node" error. */
export function isNodeLocked(model: Model, id: NodeId): boolean {
    const idx = model.byId.get(id);
    const node = idx === undefined ? undefined : model.nodes[idx];
    return node !== undefined && isEntryLocked(node.source, node.parentLocked === true);
}

/**
 * Throws a structured error if node `id` is editing-locked; no-op otherwise. This is the gate every
 * host write entry point (`editField`, `structureOp`, `spellbookEdit`) calls immediately before
 * mutating its target, so a crafted or raced webview message cannot slip an edit past the same lock
 * the webview already disables its controls for (previously the lock was enforced ONLY by the
 * webview disabling controls - the host write path performed no check of its own).
 */
export function assertNotLocked(model: Model, id: NodeId): void {
    if (!isNodeLocked(model, id)) return;
    const idx = model.byId.get(id);
    const node = idx === undefined ? undefined : model.nodes[idx];
    const label = node?.name ?? id;
    throw new Error(`"${label}" is inside a locked, partially-undecoded subtree and cannot be edited.`);
}
