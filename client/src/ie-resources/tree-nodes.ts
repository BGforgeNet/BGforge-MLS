/**
 * The resource tree's node shapes, and the two pure decisions made about them.
 *
 * Separate from `tree-provider.ts` so it carries no `vscode` import: the provider itself is excluded from
 * coverage because mocking `TreeDataProvider` would recreate the framework, so anything decidable without the
 * editor lives here instead and is tested directly.
 */

/** Pinned top row showing the open game's type + path (mirrors the view header). */
export interface GameNode {
    kind: "game";
    label: string;
    dir: string;
}

export interface TypeNode {
    kind: "type";
    type: number;
    ext: string;
    count: number;
}

export interface ResourceNode {
    kind: "resource";
    resref: string;
    type: number;
    ext: string;
    openable: boolean;
}

export type Node = GameNode | TypeNode | ResourceNode;

/**
 * A stable identity for a tree row.
 *
 * `TreeView.reveal` needs one, and without an explicit id VS Code derives it from the label - so a row whose
 * label changes loses its selection and expansion state. Keyed on the resType number rather than the
 * extension because the type is what the tree groups by, and an unknown type has no extension to key on.
 */
export function nodeId(node: Node): string {
    if (node.kind === "game") return `game:${node.dir}`;
    if (node.kind === "type") return `type:${node.type}`;
    return `resource:${node.type}:${node.resref}`;
}

/**
 * Which type group a row belongs under, or undefined for a row that sits at the root.
 *
 * `TreeView.reveal` cannot expand to a row without walking up from it, and the walk stops at the root. The
 * provider turns this number back into the group's own node, since only it knows the group's count.
 */
export function parentTypeOf(node: Node): number | undefined {
    return node.kind === "resource" ? node.type : undefined;
}
