import type { BinaryEditorNode } from "./binaryEditor-messages";

export function shouldRecursivelyLoadTree(expandAllActive: boolean, searchQuery: string): boolean {
    return expandAllActive || searchQuery.trim().length > 0;
}

export function getLoadableGroupIds(
    nodes: readonly BinaryEditorNode[],
    childrenLoaded: ReadonlySet<string>,
    loadingChildren: ReadonlySet<string>,
): string[] {
    return nodes
        .filter(
            (node) =>
                node.kind === "group" &&
                node.expandable &&
                !childrenLoaded.has(node.id) &&
                !loadingChildren.has(node.id),
        )
        .map((node) => node.id);
}
