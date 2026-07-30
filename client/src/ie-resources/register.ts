import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { conlog } from "../logging";
import { GameResourceFileSystemProvider } from "./fs-provider";
import { GameSession } from "./session";
import { GameResourceTreeProvider, type ResourceNode } from "./tree-provider";
import {
    createNamingTableResolver,
    createResourceListResolver,
    createEngineResolver,
    createResourceTypeResolver,
    createSlotLabelResolver,
    createStrrefResolver,
    type NamingTableResolver,
    type ResourceListResolver,
    type EngineResolver,
    type ResourceTypeResolver,
    type SlotLabelResolver,
    type StrrefResolver,
} from "./game-lookups";
import { viewTypeForResource } from "./editor-routing";
import { GAME_RESOURCE_SCHEME, parseResourceUri, resourceUri } from "./uri";

const LAST_DIR_KEY = "bgforge.ieResources.lastDir";
const HAS_GAME_CONTEXT = "bgforge.ieResources.hasGame";

/**
 * Wire up the IE game resource viewer: the sidebar tree, the game-resource FS provider, and its commands.
 * Returns lookups over the session it owns, so the binary editor can turn a strref into text and a slot into
 * its IDS name without reaching for a `Game` of its own.
 */
export function registerIeResources(context: vscode.ExtensionContext): {
    strref: StrrefResolver;
    slotLabel: SlotLabelResolver;
    namingTable: NamingTableResolver;
    resourceType: ResourceTypeResolver;
    resourceList: ResourceListResolver;
    engine: EngineResolver;
} {
    const session = new GameSession();
    const tree = new GameResourceTreeProvider(session);
    const fsProvider = new GameResourceFileSystemProvider(session);
    const treeView = vscode.window.createTreeView("bgforge.ieResources", {
        treeDataProvider: tree,
        showCollapseAll: true,
    });

    const setHasGame = (has: boolean): Thenable<unknown> =>
        vscode.commands.executeCommand("setContext", HAS_GAME_CONTEXT, has);

    // Reflect the open game in the view header. The activity-bar container is titled "BGforge", and VS Code
    // renders the header as "<container>: <view title>", so the view title is just the compact game type -> the
    // header reads "BGforge: BG2". The full name is the dimmed description and the path is the message.
    const updateHeader = (): void => {
        const current = session.current;
        treeView.title = current ? current.game.identity.shortLabel : "Resources";
        treeView.description = current?.game.identity.label;
        treeView.message = current?.dir;
    };

    const openGameDir = async (dir: string): Promise<void> => {
        try {
            session.open(dir);
        } catch (error) {
            conlog(
                `ieResources: openGame failed for ${dir}: ${error instanceof Error ? error.message : String(error)}`,
            );
            void vscode.window.showErrorMessage(`Not an Infinity Engine game folder (no chitin.key): ${dir}`);
            return;
        }
        await context.workspaceState.update(LAST_DIR_KEY, dir);
        fsProvider.clearCache(); // a reopened dir must re-read, not serve a prior session's bytes
        await setHasGame(true);
        tree.refresh();
        updateHeader();
    };

    const openGameFolder = async (): Promise<void> => {
        // Select the game's chitin.key directly (unambiguous marker); the game dir is its parent.
        const picked = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: { "IE game index (chitin.key)": ["key"] },
            openLabel: "Select chitin.key",
            title: "Select the game's chitin.key",
        });
        const keyFile = picked?.[0]?.fsPath;
        if (keyFile) await openGameDir(path.dirname(keyFile));
    };

    /**
     * Open one resource of a game by resref+ext. Shared by the tree's own open and the binary editor's
     * open-a-referenced-resource affordance, so the binary-vs-default-editor choice lives in one place.
     *
     * Everything reached from here is an IE resource by construction, so `viewTypeForResource` decides - see it
     * for why the registry is asked about that family specifically, and why the view is always named.
     */
    const openRef = async (gameDir: string, resref: string, ext: string): Promise<void> => {
        let game;
        try {
            game = session.ensureOpen(gameDir);
        } catch {
            return;
        }
        if (!game.canRead(resref, ext)) {
            void vscode.window.showWarningMessage(
                `${resref}.${ext} is unavailable: its archive is not installed in this game.`,
            );
            return;
        }
        const uri = resourceUri(gameDir, resref, ext);
        // `preview: false` pins each resource to its own tab: following a reference is deliberate, not the
        // browse-and-discard a preview tab models, so a second follow must not evict the first.
        const showOptions: vscode.TextDocumentShowOptions = { preview: false };
        await vscode.commands.executeCommand("vscode.openWith", uri, viewTypeForResource(ext), showOptions);
    };

    const openResource = async (element?: ResourceNode): Promise<void> => {
        const current = session.current;
        if (!current || !element) return;
        await openRef(current.dir, element.resref, element.ext);
    };

    /** The binary editor's open-a-referenced-resource affordance; the document URI names which game. */
    const openRefFromDocument = async (arg?: {
        documentUri?: vscode.Uri;
        resref?: string;
        ext?: string;
    }): Promise<void> => {
        if (!arg?.documentUri || !arg.resref || !arg.ext) return;
        const { gameDir } = parseResourceUri(arg.documentUri);
        if (!gameDir) return;
        await openRef(gameDir, arg.resref, arg.ext);
    };

    context.subscriptions.push(
        { dispose: () => session.dispose() },
        treeView,
        vscode.workspace.registerFileSystemProvider(GAME_RESOURCE_SCHEME, fsProvider, {
            isReadonly: false,
            isCaseSensitive: false,
        }),
        vscode.commands.registerCommand("bgforge.ieResources.openGame", openGameFolder),
        vscode.commands.registerCommand("bgforge.ieResources.refresh", () => tree.refresh()),
        vscode.commands.registerCommand("bgforge.ieResources.closeGame", async () => {
            session.close();
            fsProvider.clearCache();
            await setHasGame(false);
            tree.refresh();
            updateHeader();
        }),
        vscode.commands.registerCommand("bgforge.ieResources.open", openResource),
        vscode.commands.registerCommand("bgforge.ieResources.openRef", openRefFromDocument),
    );

    /**
     * Restore the last-opened game (independent of the workspace) for continuity across reloads - but not
     * during activation, and only once the resource view is actually shown.
     *
     * Opening a game is synchronous and proportional to the install: it parses `chitin.key`, indexes every
     * resource it names, and scans the override folders. The extension also activates for a script file, and
     * paying that on the activation path would stall the host for a view the user may never open. A restored
     * binary editor does not depend on this - the FS provider opens the game from the URI on demand.
     */
    const lastDir = context.workspaceState.get<string>(LAST_DIR_KEY);
    const restorable = lastDir !== undefined && fs.existsSync(path.join(lastDir, "chitin.key"));
    let restored = false;
    const restoreLastGame = async (): Promise<void> => {
        if (restored || !restorable) return;
        restored = true; // set before awaiting, so a second visibility event cannot start a parallel open
        await openGameDir(lastDir);
    };
    void setHasGame(false);
    context.subscriptions.push(
        treeView.onDidChangeVisibility((event) => {
            if (event.visible) void restoreLastGame();
        }),
    );
    // Already showing (the view was the reason for activation), so no visibility change is coming.
    if (treeView.visible) void restoreLastGame();

    return {
        strref: createStrrefResolver(session),
        slotLabel: createSlotLabelResolver(session),
        namingTable: createNamingTableResolver(session),
        resourceType: createResourceTypeResolver(session),
        resourceList: createResourceListResolver(session),
        engine: createEngineResolver(session),
    };
}
