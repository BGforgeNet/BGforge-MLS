/**
 * The gallery's commands, its panel serializer, and the two sources it can browse.
 *
 * The serializer is what makes a panel survive a window reload. It only runs if the extension is active by
 * then, which is what `onWebviewPanel:bgforge.gallery` in package.json guarantees - without that event VS
 * Code restores the panel's frame and finds nobody to fill it, leaving a permanently blank tab.
 */
import * as vscode from "vscode";
import { gameSource } from "./game-source";
import { GALLERY_VIEW_TYPE, type GalleryPanelState, wireGalleryPanel } from "./panel";
import { type GallerySource } from "./source";
import { workspaceSource } from "./workspace-source";
import { resourceUri } from "../ie-resources/uri";
import { createAnimationIndexResolver } from "../ie-resources/animation-index";
import { setTile } from "./set-tiles";
import { type SetTile } from "./webview/messages";
import { type Game } from "@bgforge/binary";

export interface GalleryHostDeps {
    /** The open install, or undefined with none - read per panel, so opening a game does not need a reload. */
    gameSession: () => { dir: string; game: Game } | undefined;
    /** Show a game resource in the resource tree - `registerIeResources`'s own reveal. */
    revealResource: (resref: string, ext: string) => Promise<void>;
}

export function registerGallery(context: vscode.ExtensionContext, deps: GalleryHostDeps): void {
    const animationIndex = createAnimationIndexResolver({
        gameAt: (dir) => (deps.gameSession()?.dir === dir ? deps.gameSession()?.game : undefined),
    });

    const sets = (): readonly SetTile[] => {
        const current = deps.gameSession();
        if (current === undefined) return [];
        return (animationIndex(current.dir) ?? []).map((set) => setTile(set));
    };

    /** Open the BAM a set draws, through the same resource URI every other game item opens by. */
    const openSet = async (id: number): Promise<void> => {
        const current = deps.gameSession();
        if (current === undefined) return;
        const set = (animationIndex(current.dir) ?? []).find((entry) => entry.id === id);
        const resref = set === undefined ? undefined : setTile(set).resref;
        if (resref === undefined) return;
        await vscode.commands.executeCommand("vscode.open", resourceUri(current.dir, resref, "bam"));
    };

    const sourceFor = (kind: "game" | "workspace"): GallerySource | undefined => {
        if (kind === "game") {
            const current = deps.gameSession();
            return current === undefined ? undefined : gameSource(current.game, { reveal: deps.revealResource });
        }
        const folders = vscode.workspace.workspaceFolders ?? [];
        if (folders.length === 0) return undefined;
        return workspaceSource(
            folders.map((folder) => ({ name: folder.name, path: folder.uri.fsPath })),
            {
                reveal: async (fsPath) => {
                    await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(fsPath));
                },
            },
        );
    };

    /**
     * Open the item, then reveal it where it lives.
     *
     * Both, and in that order: the click is a request to look at the resource, and the reveal is what tells
     * the reader where the thing they are now looking at came from.
     */
    const open = async (source: GallerySource, id: string): Promise<void> => {
        const at = source.locate(id);
        if (at === undefined) return;
        if (source.kind === "workspace" && at.kind === "file") {
            await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(at.path));
        } else {
            const current = deps.gameSession();
            const item = source.list().find((entry) => entry.id === id);
            if (current === undefined || item === undefined) return;
            await vscode.commands.executeCommand("vscode.open", resourceUri(current.dir, item.label, item.ext));
        }
        await source.reveal(id);
    };

    const show = (kind: "game" | "workspace"): void => {
        const panel = vscode.window.createWebviewPanel(
            GALLERY_VIEW_TYPE,
            kind === "game" ? "Game Image Gallery" : "Workspace Image Gallery",
            vscode.ViewColumn.Active,
            { enableScripts: true, retainContextWhenHidden: true },
        );
        wireGalleryPanel(panel, { source: kind }, context, { sourceFor, open, sets, openSet });
    };

    context.subscriptions.push(
        vscode.commands.registerCommand("bgforge.gallery.showGame", () => show("game")),
        vscode.commands.registerCommand("bgforge.gallery.showWorkspace", () => show("workspace")),
        vscode.window.registerWebviewPanelSerializer(GALLERY_VIEW_TYPE, {
            async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: unknown): Promise<void> {
                // A restored panel whose state VS Code could not persist falls back to the workspace, which
                // is the source that needs no game open - a blank panel would be the alternative.
                const kind = (state as GalleryPanelState | undefined)?.source === "game" ? "game" : "workspace";
                wireGalleryPanel(panel, { source: kind }, context, { sourceFor, open, sets, openSet });
            },
        }),
    );
}
