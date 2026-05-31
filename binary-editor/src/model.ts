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
}

export interface Model {
    parseResult: ParseResult;
    nodes: FlatNode[];
    /** id -> index into `nodes`. */
    byId: Map<NodeId, number>;
}

/** Pre-order flatten of the parsed tree. The root group is not itself a node;
 *  its children are the depth-0 nodes. Ids are positional (`parentId/childIndex`)
 *  so they are stable for a given tree shape and unique by construction. */
export function buildModel(parseResult: ParseResult): Model {
    const nodes: FlatNode[] = [];
    const byId = new Map<NodeId, number>();

    const walk = (
        entries: (ParsedField | ParsedGroup)[],
        depth: number,
        parentId: NodeId | undefined,
        parentNamePath: NamePath,
    ): void => {
        entries.forEach((entry, index) => {
            const id = parentId === undefined ? String(index) : `${parentId}/${index}`;
            const namePath: NamePath = [...parentNamePath, entry.name];
            const group = isGroup(entry) ? entry : undefined;
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
            });
            if (group) walk(group.fields, depth + 1, id, namePath);
        });
    };

    walk(parseResult.root.fields, 0, undefined, []);
    return { parseResult, nodes, byId };
}
