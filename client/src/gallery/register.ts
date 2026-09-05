/**
 * The gallery's commands, its panel serializer, and the two sources it can browse.
 *
 * The serializer is what makes a panel survive a window reload. It only runs if the extension is active by
 * then, which is what `onWebviewPanel:bgforge.gallery` in package.json guarantees - without that event VS
 * Code restores the panel's frame and finds nobody to fill it, leaving a permanently blank tab.
 */
import * as vscode from "vscode";
import { gameSource } from "./game-source";
import { GALLERY_VIEW_TYPE, type GalleryDeps, type GalleryPanelState, wireGalleryPanel } from "./panel";
import { type GallerySource } from "./source";
import { workspaceSource } from "./workspace-source";
import { resourceUri } from "../ie-resources/uri";
import { openAnimationSet } from "../ie-resources/open-set";
import { type AnimationIndexResolver, setTile } from "@bgforge/animation";
import { createFacetBrowser, type FacetBrowser } from "./facet-state";
import { type SetTile } from "./webview/messages";
import { type Game } from "@bgforge/binary";

export interface GalleryHostDeps {
    /** The open install, or undefined with none. Asked per lookup, so it is never a stale capture. */
    gameSession: () => { dir: string; game: Game } | undefined;
    /** The animations the open install declares - the resource viewer's own index, shared not rebuilt. */
    animations: AnimationIndexResolver;
    /** Show a game resource in the resource tree - `registerIeResources`'s own reveal. */
    revealResource: (resref: string, ext: string) => Promise<void>;
    /** Fires when the open install changes; a wired panel re-reads the corpus on it. */
    onDidChangeGame: vscode.Event<void>;
}

export function registerGallery(context: vscode.ExtensionContext, deps: GalleryHostDeps): void {
    const sets = (): readonly SetTile[] => {
        const current = deps.gameSession();
        if (current === undefined) return [];
        const exists = (resref: string): boolean => current.game.canRead(resref, "bam");
        return (deps.animations(current.dir) ?? []).map((set) => setTile(set, exists));
    };

    /** Open an animation's BAM, through the same resource URI every other game item opens by. */
    const openResref = async (resref: string): Promise<void> => {
        const current = deps.gameSession();
        if (current === undefined) return;
        await vscode.commands.executeCommand("vscode.open", resourceUri(current.dir, resref, "bam"));
    };

    /**
     * A facet browser over the open game, or undefined with none.
     *
     * Availability is asked of the archive rather than of the index, because a table can name a combination
     * whose files the install does not ship - and the browser must not offer a file that will not open.
     */
    const facets = (): FacetBrowser | undefined => {
        const current = deps.gameSession();
        if (current === undefined) return undefined;
        const animations = deps.animations(current.dir);
        if (animations === undefined) return undefined;
        return createFacetBrowser(animations, (resref) => current.game.canRead(resref, "bam"));
    };

    /** Hand a whole set to the animation editor, through the same open the editor's own picker uses. */
    const openSetEditor = async (id: number): Promise<void> => {
        const current = deps.gameSession();
        if (current === undefined) return;
        await openAnimationSet(deps.animations, current.dir, id);
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

    /**
     * One set of deps for both ways a panel comes into being.
     *
     * Shared rather than built per call site: the two differ only in the state they start from, and a dep
     * added to one and forgotten in the other breaks exactly the restored panel - the path nobody exercises
     * until a window reload.
     */
    const panelDeps = {
        sourceFor,
        open,
        sets,
        openResref,
        facets,
        openSetEditor,
        onDidChangeGame: deps.onDidChangeGame,
    } satisfies GalleryDeps;

    const show = (kind: "game" | "workspace", focusSet?: number): void => {
        const panel = vscode.window.createWebviewPanel(
            GALLERY_VIEW_TYPE,
            kind === "game" ? "Game Image Gallery" : "Workspace Image Gallery",
            vscode.ViewColumn.Active,
            { enableScripts: true, retainContextWhenHidden: true },
        );
        const state = { source: kind, ...(focusSet === undefined ? {} : { focusSet }) };
        wireGalleryPanel(panel, state, context, panelDeps);
    };

    context.subscriptions.push(
        vscode.commands.registerCommand("bgforge.gallery.showGame", () => show("game")),
        vscode.commands.registerCommand("bgforge.gallery.showWorkspace", () => show("workspace")),
        // Takes the id rather than a resolved set: the caller is a creature's animation field, which holds a
        // number and cannot say whether this install names it.
        vscode.commands.registerCommand("bgforge.gallery.showAnimation", (id: unknown) => {
            if (typeof id === "number") show("game", id);
        }),
        vscode.window.registerWebviewPanelSerializer(GALLERY_VIEW_TYPE, {
            async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: unknown): Promise<void> {
                // A restored panel whose state VS Code could not persist falls back to the workspace, which
                // is the source that needs no game open - a blank panel would be the alternative.
                const kind = (state as GalleryPanelState | undefined)?.source === "game" ? "game" : "workspace";
                wireGalleryPanel(panel, { source: kind }, context, panelDeps);
            },
        }),
    );
}
