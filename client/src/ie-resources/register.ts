import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { conlog } from "../logging";
import { GameResourceFileSystemProvider } from "./fs-provider";
import { CurrentGame } from "./current-game";
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
    createStringTableProbe,
    createStrrefSearch,
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
import { pickStrref } from "./strref-picker";
import { GAME_RESOURCE_SCHEME, parseResourceUri, resourceUri } from "./uri";
import { resourceTypeCode, type Game } from "@bgforge/binary";
import { DlgReferenceIndex, type DlgSource, type InboundRef } from "../dialog-editor/dlg-references";

const HAS_GAME_CONTEXT = "bgforge.ieResources.hasGame";

/**
 * The game's dialogs, for the cross-reference scan. Built in the BACKGROUND when a game opens: the scan is
 * proportional to the install, and `openGame` is already the expensive step that was deliberately kept off
 * the activation path - so this must not sit on it either. The previous scan is abandoned when a new game
 * opens, rather than left to finish into a session nobody is looking at.
 */
function dlgSourceFor(game: Game): DlgSource {
    const dlgType = resourceTypeCode("dlg");
    return {
        list: () =>
            game
                .list()
                .filter((resource) => resource.type === dlgType)
                .map((resource) => resource.resref),
        read: (resref) => game.read(resref, dlgType),
    };
}

/**
 * The document a tab shows, or undefined for one this extension never opens a resource into.
 *
 * Two input kinds cover every route a resource takes: a custom editor (the binary, animation and dialog
 * editors) and a plain text editor (the formats that render as text). A tab whose input is neither cannot be
 * showing a game resource, so it is not ours to close.
 */
function tabUri(tab: vscode.Tab): vscode.Uri | undefined {
    if (tab.input instanceof vscode.TabInputCustom) return tab.input.uri;
    if (tab.input instanceof vscode.TabInputText) return tab.input.uri;
    return undefined;
}

/**
 * Close every editor showing a resource from `gameDir`.
 *
 * Exactly one install is open at a time, so when one is replaced its resources become unreadable and a tab
 * still showing one would fail on every read, save and refresh. Closing them is what makes the switch mean
 * what it says. Scoped by the URI's own game directory: tabs on the workspace's files, and on any other
 * scheme, are untouched - the game changed, not the mod.
 *
 * A dirty tab raises VS Code's own save prompt and the user may cancel it, which is why the outcome is
 * reported rather than assumed.
 */
async function closeResourceTabs(gameDir: string): Promise<void> {
    const stale = vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .filter((tab) => {
            const uri = tabUri(tab);
            return uri?.scheme === GAME_RESOURCE_SCHEME && parseResourceUri(uri).gameDir === gameDir;
        });
    if (stale.length === 0) return;
    if (!(await vscode.window.tabGroups.close(stale))) {
        conlog(`ieResources: some editors for ${gameDir} stayed open; their resources are no longer readable`);
    }
}

/**
 * Wire up the IE game resource viewer: the sidebar tree, the game-resource FS provider, and its commands.
 * Returns lookups over the open game it owns, so the binary editor can turn a strref into text and a slot into
 * its IDS name without reaching for a `Game` of its own.
 */
export function registerIeResources(context: vscode.ExtensionContext): {
    /** Which replies lead into a dialog state; `undefined` until the game-wide scan has finished. */
    inbound: (resref: string, stateIndex: number) => InboundRef[] | undefined;
    /** Every reply elsewhere leading into this dialog; empty until the scan has finished, as `inbound` is. */
    inboundToDialog: (resref: string) => InboundRef[];
    strref: StrrefResolver;
    /** Whether the document's game has a `dialog.tlk` to resolve strrefs against at all. */
    hasStrings: (uri: vscode.Uri) => boolean;
    /** Opens the string picker for a document, resolving to the chosen strref or undefined if dismissed. */
    pickStrref: (uri: vscode.Uri, title: string) => Promise<number | undefined>;
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
    // Read per open, so correcting a garbled classic game takes effect on the next open rather than needing a
    // window reload. Empty means "let the library decide" - UTF-8 for Enhanced Editions, windows-1252 otherwise.
    const currentGame = new CurrentGame(() => {
        const encoding = vscode.workspace.getConfiguration("bgforge").get<string>("weidu.tlkEncoding", "");
        return encoding === "" ? undefined : encoding;
    });

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
    const fallbackGameDir = (): string | undefined => configuredGameDir() ?? currentGame.current?.dir;

    // Built once and shared: the resolver is also the value this returns to the binary editor, and the picker
    // needs both halves - search to find a string, resolve to show the one a typed number already names.
    const strrefResolver = createStrrefResolver(currentGame, fallbackGameDir);
    const strrefSearch = createStrrefSearch(currentGame, fallbackGameDir);
    const tree = new GameResourceTreeProvider(currentGame);
    const fsProvider = new GameResourceFileSystemProvider(currentGame);
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
        const current = currentGame.current;
        treeView.title = current ? current.game.identity.shortLabel : "Resources";
        treeView.description = current?.game.identity.label;
        treeView.message = current?.dir;
    };

    /**
     * The cross-dialog reference index, and the scan that fills it. Kept per-session rather than per-editor:
     * every open `.dlg` asks the same question, and the scan is far too big to repeat per tab.
     */
    const references = new DlgReferenceIndex();
    let referenceScan: AbortController | undefined;
    /** Which game the current scan covers, so asking about it again does not restart it. */
    let scannedDir: string | undefined;
    const scanReferences = (dir: string): void => {
        if (dir === scannedDir) return;
        referenceScan?.abort();
        let game;
        try {
            // Opening, not just fetching: the scan can be the first thing to need this game, and a dialog
            // opened straight from the explorer reaches it through the configured path rather than the view.
            game = currentGame.gameAt(dir);
        } catch (error) {
            conlog(`ieResources: no game to scan at ${dir}: ${error instanceof Error ? error.message : String(error)}`);
            return;
        }
        // Undefined means another install is open, so this dir is not what anything resolves against - the
        // scan for whatever IS open runs on its own open.
        if (game === undefined) return;
        scannedDir = dir;
        const controller = new AbortController();
        referenceScan = controller;
        // Deliberately not awaited: this returns to the caller immediately and the scan yields as it goes,
        // so opening a game costs exactly what it did before.
        void references.build(dlgSourceFor(game), controller.signal).catch((error: unknown) => {
            // Release the dir so a later open retries it. Without this a failed scan is indistinguishable
            // from one still running, permanently: `references.ready` stays false, `inbound` keeps answering
            // undefined, and every detach prompt reports "the reference scan is still building" for the rest
            // of the session - a scan that will never run again described as one about to finish.
            if (scannedDir === dir) scannedDir = undefined;
            const reason = error instanceof Error ? error.message : String(error);
            conlog(`ieResources: dialog reference scan failed: ${reason}`);
            // Said out loud, not only logged: the editor keeps working, but every detach prompt is now
            // reporting an unknown rather than a checked "nothing else reaches this state", and that
            // difference is the whole reason the scan exists.
            void vscode.window.showWarningMessage(
                `Could not scan ${dir} for dialog cross-references, so this session cannot say which other ` +
                    `dialogs reach a state. ${reason}`,
            );
        });
    };

    /** Close the open game and everything showing its resources. Shared by the command and the setting watcher. */
    const closeCurrentGame = async (): Promise<void> => {
        const closed = currentGame.current?.dir;
        currentGame.close();
        fsProvider.clearCache();
        if (closed !== undefined) await closeResourceTabs(closed);
        await setHasGame(false);
        tree.refresh();
        updateHeader();
    };

    const openGameDir = async (dir: string): Promise<void> => {
        // Read before the open replaces it: the tabs to close are the OUTGOING game's, and after `open` there
        // is nothing left to say which install that was.
        const replaced = currentGame.current?.dir;
        try {
            currentGame.open(dir);
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
        fsProvider.clearCache(); // a reopened dir must re-read, not serve a prior game's bytes
        // The replaced install is closed, so its resources are no longer readable and any tab still showing one
        // would fail every operation. Only that game's resource tabs go - the workspace's own files are not
        // what changed.
        if (replaced !== undefined && replaced !== dir) await closeResourceTabs(replaced);
        scanReferences(dir);
        await setHasGame(true);
        tree.refresh();
        updateHeader();
    };

    /**
     * Start the scan for whichever game is in play, if it has not run for that one yet. A game becomes
     * available two ways: opened through the view, or resolved lazily from the configured path the first time
     * something asks it for a string. Only the first calls `openGameDir`, so without this a `.dlg` opened
     * straight from the explorer would have every strref resolved and still report that nothing had been
     * checked - a scan tied to a view the user never opened.
     */
    const ensureScanned = (): void => {
        const dir = fallbackGameDir();
        if (dir !== undefined) scanReferences(dir);
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
            game = currentGame.gameAt(gameDir);
        } catch {
            return;
        }
        if (game === undefined) return; // a reference into a game that is no longer the open one
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
        const current = currentGame.current;
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
        { dispose: () => currentGame.dispose() },
        { dispose: () => referenceScan?.abort() },
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
            currentGame.current?.game.rescan();
            fsProvider.clearCache();
            tree.refresh();
        }),
        vscode.commands.registerCommand("bgforge.ieResources.closeGame", closeCurrentGame),
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
        /**
         * Follow `weidu.gamePath` when it is edited directly rather than through the view.
         *
         * Opening a game writes this setting, so the two normally agree and the guard below swallows the write
         * this module just made. It matters for the other direction: with one install open at a time, a
         * setting pointing elsewhere would leave every `file:` lookup resolving against a game the workspace
         * no longer targets, with nothing on screen saying so.
         *
         * Cleared or invalid is left alone rather than closing anything - `fallbackGameDir` already falls back
         * to the open game, which is the behaviour a user who empties the setting still gets.
         */
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (!event.affectsConfiguration("bgforge.weidu.gamePath")) return;
            const dir = configuredGameDir();
            if (dir === undefined || dir === currentGame.current?.dir) return;
            if (treeView.visible) {
                restored = true; // the view now follows the setting; a later visibility event adds nothing
                void openGameDir(dir);
                return;
            }
            // Not showing: close rather than open. Opening parses `chitin.key` and indexes every resource it
            // names, and the view is deliberately the only thing that pays that - the next lookup opens the
            // newly configured game lazily through `gameAt`.
            //
            // Also un-latch the restore guard: this close was the setting's doing, not the user's, so the
            // view must pick the new game back up on its next show rather than staying blank because an
            // earlier restore already ran. An explicit Close Game leaves `restored` alone - that one should.
            restored = false;
            void closeCurrentGame();
        }),
    );
    // Already showing (the view was the reason for activation), so no visibility change is coming.
    if (treeView.visible) void restoreGame();

    return {
        /**
         * Replies leading into a dialog state. `undefined` while the scan is still running - the caller must
         * not present that as "nothing points here".
         */
        inbound: (resref: string, stateIndex: number) => {
            ensureScanned();
            return references.ready ? references.inbound(resref, stateIndex) : undefined;
        },
        // Empty rather than undefined while the scan runs: this only decides which extra states the tree
        // shows, so an incomplete answer costs a branch, not a wrong statement about what reaches a state.
        inboundToDialog: (resref: string) => {
            ensureScanned();
            return references.ready ? references.inboundToDialog(resref) : [];
        },
        strref: strrefResolver,
        hasStrings: createStringTableProbe(currentGame, fallbackGameDir),
        pickStrref: (uri, title) => pickStrref(strrefSearch, (ref) => strrefResolver(uri, ref), uri, { title }),
        slotLabel: createSlotLabelResolver(currentGame, fallbackGameDir),
        namingTable: createNamingTableResolver(currentGame, fallbackGameDir),
        resourceType: createResourceTypeResolver(currentGame, fallbackGameDir),
        flagBitNames: createFlagBitNamesResolver(currentGame, fallbackGameDir),
        resourceList: createResourceListResolver(currentGame, fallbackGameDir),
        resourceBytes: createResourceBytesResolver(currentGame, fallbackGameDir),
        engine: createEngineResolver(currentGame, fallbackGameDir),
        bcsSymbols: createBcsSymbolResolver(currentGame, fallbackGameDir),
        isGameBacked: (uri) => isGameDocument(uri, fallbackGameDir),
    };
}
