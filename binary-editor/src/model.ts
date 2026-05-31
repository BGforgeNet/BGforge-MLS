import type { ParsedField, ParsedGroup, ParseResult } from "@bgforge/binary";
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
}

export interface Model {
    parseResult: ParseResult;
    nodes: FlatNode[];
    /** id -> index into `nodes`. */
    byId: Map<NodeId, number>;
    /** Set of group NodeIds that are currently expanded. */
    expanded: Set<NodeId>;
}

/** Pre-order flatten of the parsed tree. The root group is not itself a node;
 *  its children are the depth-0 nodes. Ids are positional (`parentId/childIndex`)
 *  so they are stable for a given tree shape and unique by construction. */
export function buildModel(parseResult: ParseResult): Model {
    const nodes: FlatNode[] = [];
    const byId = new Map<NodeId, number>();
    const expanded = new Set<NodeId>();

    const walk = (
        entries: (ParsedField | ParsedGroup)[],
        depth: number,
        parentId: NodeId | undefined,
        parentNamePath: NamePath,
        parentLocked: boolean,
    ): void => {
        entries.forEach((entry, index) => {
            const id = parentId === undefined ? String(index) : `${parentId}/${index}`;
            const namePath: NamePath = [...parentNamePath, entry.name];
            const group = isGroup(entry) ? entry : undefined;
            // A node is locked if any ancestor group carries editingLocked === true.
            const locked = parentLocked || group?.editingLocked === true;
            byId.set(id, nodes.length);
            nodes.push({
                id,
                namePath,
                depth,
                parentId,
                kind: group ? "group" : "field",
                source: entry,
                childCount: group ? group.fields.length : 0,
                name: entry.name,
                parentLocked: parentLocked || undefined,
            });
            if (group) walk(group.fields, depth + 1, id, namePath, locked);
        });
    };

    walk(parseResult.root.fields, 0, undefined, [], false);
    return { parseResult, nodes, byId, expanded };
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
