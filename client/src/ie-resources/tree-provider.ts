import * as path from "path";
import * as vscode from "vscode";
import { resourceTypeExt, type GameResourceRef } from "@bgforge/binary";
import { hasViewerFor } from "./editor-routing";
import { type CurrentGame } from "./current-game";
import { resourceUri } from "./uri";
import { type Node, type ResourceNode, type TypeNode, nodeId, parentTypeOf } from "./tree-nodes";

// Re-exported so existing importers keep reaching `ResourceNode` here, where it lived before the pure half
// was split out.
export type { ResourceNode } from "./tree-nodes";

// ITM/SPL/CRE v1 headers carry the (unidentified / long) name strref at byte 0x08 (IESDP). Read raw rather
// than through the spec's `strref` field property (which is what the binary editor resolves from): a hover
// must not parse a whole record, and this is one constant, not a second copy of the resolution logic.
// `binary/test/external-refs.test.ts` pins the offset against the specs so a moved field can't silently make
// this tooltip resolve the wrong string.
const NAME_STRREF_OFFSET = 8;
const NAME_STRREF_TYPES = new Set<number>([0x03ed /* ITM */, 0x03ee /* SPL */, 0x03f1 /* CRE */]);

/** Shows an open IE game's resources grouped by type; record types open in the binary editor. */
export class GameResourceTreeProvider implements vscode.TreeDataProvider<Node> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    // Grouped resources for the current game, built once per open and cleared on refresh.
    private grouped: Map<number, GameResourceRef[]> | undefined;
    private readonly currentGame: CurrentGame;

    constructor(currentGame: CurrentGame) {
        this.currentGame = currentGame;
    }

    refresh(): void {
        this.grouped = undefined;
        this._onDidChangeTreeData.fire();
    }

    private ensureGrouped(): Map<number, GameResourceRef[]> {
        if (this.grouped) return this.grouped;
        const grouped = new Map<number, GameResourceRef[]>();
        const current = this.currentGame.current;
        if (current) {
            for (const resource of current.game.list()) {
                const list = grouped.get(resource.type);
                if (list) list.push(resource);
                else grouped.set(resource.type, [resource]);
            }
        }
        this.grouped = grouped;
        return grouped;
    }

    getChildren(element?: Node): Node[] {
        const current = this.currentGame.current;
        if (!current) return [];
        if (!element) {
            // Built through the same helper `getParent` uses: `reveal` matches a row to its parent by id, so
            // the two constructions drifting would break the walk with nothing failing at the site.
            const typeNodes: TypeNode[] = [];
            for (const type of this.ensureGrouped().keys()) {
                const node = this.typeNodeFor(type);
                if (node) typeNodes.push(node);
            }
            typeNodes.sort((a, b) => a.ext.localeCompare(b.ext));
            // Pinned game row first, then the type groups.
            return [{ kind: "game", label: current.game.identity.label, dir: current.dir }, ...typeNodes];
        }
        if (element.kind === "type") {
            const openable = hasViewerFor(element.ext);
            return (this.ensureGrouped().get(element.type) ?? [])
                .map((r): ResourceNode => ({
                    kind: "resource",
                    resref: r.resref,
                    type: r.type,
                    ext: element.ext,
                    openable,
                }))
                .sort((a, b) => a.resref.localeCompare(b.resref));
        }
        return [];
    }

    /** The group a row sits under. `TreeView.reveal` refuses to work without this. */
    getParent(element: Node): Node | undefined {
        const type = parentTypeOf(element);
        return type === undefined ? undefined : this.typeNodeFor(type);
    }

    /** The row for one resource, so a caller holding a resref can reveal it. */
    resourceNode(resref: string, ext: string): ResourceNode | undefined {
        const wanted = resref.toUpperCase();
        for (const [type, list] of this.ensureGrouped()) {
            const groupExt = resourceTypeExt(type);
            if (groupExt?.toLowerCase() !== ext.toLowerCase()) continue;
            const found = list.find((r) => r.resref.toUpperCase() === wanted);
            if (found) {
                return {
                    kind: "resource",
                    resref: found.resref,
                    type,
                    ext: groupExt,
                    openable: hasViewerFor(groupExt),
                };
            }
        }
        return undefined;
    }

    private typeNodeFor(type: number): TypeNode | undefined {
        const list = this.ensureGrouped().get(type);
        if (!list) return undefined;
        return { kind: "type", type, ext: resourceTypeExt(type) ?? `0x${type.toString(16)}`, count: list.length };
    }

    getTreeItem(element: Node): vscode.TreeItem {
        const item = this.buildTreeItem(element);
        // Explicit, so a row keeps its selection and expansion state when its label or count changes - and so
        // `reveal` can match a node it was handed against the row already on screen.
        item.id = nodeId(element);
        return item;
    }

    private buildTreeItem(element: Node): vscode.TreeItem {
        if (element.kind === "game") {
            const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
            item.description = element.dir;
            item.tooltip = `${element.label}\n${element.dir}`;
            item.iconPath = new vscode.ThemeIcon("database");
            item.contextValue = "bgforgeGameInfo";
            // Reveal the game's chitin.key in the OS file manager - desktop only. The command is not registered
            // in web/remote hosts (e.g. code-server), where invoking it throws "command not found"; the label,
            // description, and tooltip already convey the game and its path, so we just skip the click there.
            if (vscode.env.uiKind === vscode.UIKind.Desktop) {
                item.command = {
                    command: "revealFileInOS",
                    title: "Reveal chitin.key",
                    arguments: [vscode.Uri.file(path.join(element.dir, "chitin.key"))],
                };
            }
            return item;
        }
        if (element.kind === "type") {
            const item = new vscode.TreeItem(element.ext.toUpperCase(), vscode.TreeItemCollapsibleState.Collapsed);
            item.description = `${element.count}`;
            item.iconPath = new vscode.ThemeIcon("symbol-folder");
            item.contextValue = "bgforgeResourceType";
            return item;
        }
        const item = new vscode.TreeItem(element.resref, vscode.TreeItemCollapsibleState.None);
        item.description = element.ext;
        // A resource URI whose basename carries the extension lets the active File Icon Theme render a per-format
        // icon (keeping the explicit resref label). Falls back to the theme's generic file icon for unknown types.
        const current = this.currentGame.current;
        if (current) item.resourceUri = resourceUri(current.dir, element.resref, element.ext);
        item.contextValue = element.openable ? "bgforgeOpenableResource" : "bgforgeResource";
        // Every resource opens; the handler routes records to the binary editor, animations to the animation
        // editor, and the rest to the default editor (text formats render as text with their language mode;
        // blobs get VS Code's binary notice).
        item.command = { command: "bgforge.ieResources.open", title: "Open", arguments: [element] };
        return item;
    }

    resolveTreeItem(item: vscode.TreeItem, element: Node): vscode.TreeItem {
        // "Show lines": resolve the record's name via dialog.tlk on hover, for the types that carry a name strref.
        if (element.kind !== "resource" || !NAME_STRREF_TYPES.has(element.type)) return item;
        const current = this.currentGame.current;
        if (!current) return item;
        try {
            const bytes = current.game.read(element.resref, element.type);
            if (bytes.byteLength >= NAME_STRREF_OFFSET + 4) {
                const strref = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
                    NAME_STRREF_OFFSET,
                    true,
                );
                const name = current.game.tlk()?.get(strref);
                if (name) item.tooltip = `${element.resref}.${element.ext} - ${name}`;
            }
        } catch {
            // Leave the default tooltip if the resource can't be read or resolved.
        }
        return item;
    }
}
