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
    createResourceBytesResolver,
    createEngineResolver,
    createResourceTypeResolver,
    createFlagBitNamesResolver,
    createSlotLabelResolver,
    createStrrefResolver,
    gameDirOf,
    isGameDocument,
    type NamingTableResolver,
    type ResourceListResolver,
    type ResourceBytesResolver,
    type EngineResolver,
    type ResourceTypeResolver,
    type FlagBitNamesResolver,
    type SlotLabelResolver,
    type StrrefResolver,
    createBcsSymbolResolver,
    type BcsSymbolResolver,
} from "./game-lookups";
import { viewTypeForResource } from "./editor-routing";
import { GAME_RESOURCE_SCHEME, resourceUri } from "./uri";

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
    flagBitNames: FlagBitNamesResolver;
    resourceList: ResourceListResolver;
    resourceBytes: ResourceBytesResolver;
    engine: EngineResolver;
    bcsSymbols: BcsSymbolResolver;
    isGameBacked: (uri: vscode.Uri) => boolean;
} {
    const session = new GameSession();

    /**
     * The game a plain `file:` record (a mod's own file) resolves against: the configured
     * `bgforge.weidu.gamePath` - the install this workspace's mod targets, already used for WeiDU
     * diagnostics, and written back whenever a game is opened in the view so the two stay in sync - or,
     * when unset, whatever game is currently open in the view.
     *
     * Validity is memoized per setting value: the check runs once per lookup batch of hundreds of rows,
     * and a game does not appear at a path mid-session often enough to justify a stat per row. A
     * `chitin.key` created at the same path later is picked up after a settings touch or reload.
     */
    let checkedPath: string | undefined;
    let checkedValid = false;
    const configuredGameDir = (): string | undefined => {
        const dir = vscode.workspace.getConfiguration("bgforge").get<string>("weidu.gamePath", "");
        if (dir === "") return undefined;
        if (dir !== checkedPath) {
            checkedPath = dir;
            checkedValid = fs.existsSync(path.join(dir, "chitin.key"));
        }
        return checkedValid ? dir : undefined;
    };
    const fallbackGameDir = (): string | undefined => configuredGameDir() ?? session.current?.dir;
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
        // Record the opened game in the setting the rest of the toolchain reads (WeiDU diagnostics, the
        // `file:` record fallback), so opening a game IS pointing the workspace at it - one source of
        // truth, restored by the view on the next reload. Workspace-scoped when a folder is open, since
        // the game is a property of the mod being worked on; user-scoped in a folderless window, where a
        // workspace write would throw.
        const config = vscode.workspace.getConfiguration("bgforge");
        if (config.get<string>("weidu.gamePath", "") !== dir) {
            const target = vscode.workspace.workspaceFolders?.length
                ? vscode.ConfigurationTarget.Workspace
                : vscode.ConfigurationTarget.Global;
            await config.update("weidu.gamePath", dir, target);
        }
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
     * open-a-referenced-resource affordance, so the choice of which editor gets it lives in one place.
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

    /**
     * The binary editor's open-a-referenced-resource affordance. Resolved through the same policy as the
     * row lookups (`gameDirOf` + the `file:` fallback), so a chip rendered for a mod's own record opens
     * against the same game that resolved it.
     */
    const openRefFromDocument = async (arg?: {
        documentUri?: vscode.Uri;
        resref?: string;
        ext?: string;
    }): Promise<void> => {
        if (!arg?.documentUri || !arg.resref || !arg.ext) return;
        const gameDir = gameDirOf(arg.documentUri, fallbackGameDir);
        if (gameDir === undefined) return;
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
        vscode.commands.registerCommand("bgforge.ieResources.refresh", () => {
            // Re-read the override folders first: the resolution tree is built at open, so a file WeiDU or
            // Near Infinity wrote since then is invisible until this runs. Cached bytes go too, or a resource
            // rewritten in place would still render from the copy taken before the refresh.
            session.current?.game.rescan();
            fsProvider.clearCache();
            tree.refresh();
        }),
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
     * Restore the configured `bgforge.weidu.gamePath` game into the view - but not during activation, and
     * only once the resource view is actually shown. The setting is both the configured default and the
     * record of the last game opened here, since opening a game writes it back.
     *
     * Opening a game is synchronous and proportional to the install: it parses `chitin.key`, indexes every
     * resource it names, and scans the override folders. The extension also activates for a script file, and
     * paying that on the activation path would stall the host for a view the user may never open. A restored
     * binary editor does not depend on this - the FS provider opens the game from the URI on demand, and the
     * `file:` fallback lookups open the configured game the same way.
     */
    let restored = false;
    const restoreGame = async (): Promise<void> => {
        const restoreDir = configuredGameDir();
        if (restored || restoreDir === undefined) return;
        restored = true; // set before awaiting, so a second visibility event cannot start a parallel open
        await openGameDir(restoreDir);
    };
    void setHasGame(false);
    context.subscriptions.push(
        treeView.onDidChangeVisibility((event) => {
            if (event.visible) void restoreGame();
        }),
    );
    // Already showing (the view was the reason for activation), so no visibility change is coming.
    if (treeView.visible) void restoreGame();

    return {
        strref: createStrrefResolver(session, fallbackGameDir),
        slotLabel: createSlotLabelResolver(session, fallbackGameDir),
        namingTable: createNamingTableResolver(session, fallbackGameDir),
        resourceType: createResourceTypeResolver(session, fallbackGameDir),
        flagBitNames: createFlagBitNamesResolver(session, fallbackGameDir),
        resourceList: createResourceListResolver(session, fallbackGameDir),
        resourceBytes: createResourceBytesResolver(session, fallbackGameDir),
        engine: createEngineResolver(session, fallbackGameDir),
        bcsSymbols: createBcsSymbolResolver(session, fallbackGameDir),
        isGameBacked: (uri) => isGameDocument(uri, fallbackGameDir),
    };
}
