import { makeUniqueKey, slugify } from "./snapshot-common";
import type { ParsedField, ParsedGroup } from "./types";

interface GroupBuildInput<Node> {
    readonly entry: ParsedGroup;
    readonly key: string;
    readonly fieldSegments: readonly string[];
    readonly children: Node[];
}

interface FieldBuildInput {
    readonly entry: ParsedField;
    readonly key: string;
    readonly fieldSegments: readonly string[];
}

interface ParsedTreeBuilder<Node> {
    readonly buildGroup: (input: GroupBuildInput<Node>) => Node;
    readonly buildField: (input: FieldBuildInput) => Node;
}

export function buildParsedTreeNode<Node>(
    entry: ParsedField | ParsedGroup,
    parentSegments: readonly string[],
    usedKeys: Map<string, number>,
    builder: ParsedTreeBuilder<Node>,
): Node {
    const baseKey = slugify(entry.name);
    const key = makeUniqueKey(baseKey, usedKeys);
    const fieldSegments = [...parentSegments, entry.name];

    if ("fields" in entry) {
        const childKeys = new Map<string, number>();
        const children = entry.fields.map((child) => buildParsedTreeNode(child, fieldSegments, childKeys, builder));
        return builder.buildGroup({
            entry,
            key,
            fieldSegments,
            children,
        });
    }

    return builder.buildField({
        entry,
        key,
        fieldSegments,
    });
}
