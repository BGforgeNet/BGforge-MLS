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
import { GAME_RESOURCE_SCHEME, resourceUri } from "./uri";
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
 * Wire up the IE game resource viewer: the sidebar tree, the game-resource FS provider, and its commands.
 * Returns lookups over the session it owns, so the binary editor can turn a strref into text and a slot into
 * its IDS name without reaching for a `Game` of its own.
 */
export function registerIeResources(context: vscode.ExtensionContext): {
    /** Which replies lead into a dialog state; `undefined` until the game-wide scan has finished. */
    inbound: (resref: string, stateIndex: number) => InboundRef[] | undefined;
    /** Every reply elsewhere leading into this dialog; empty until the scan has finished, as `inbound` is. */
    inboundToDialog: (resref: string) => InboundRef[];
    strref: StrrefResolver;
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
    const session = new GameSession(() => {
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
    const fallbackGameDir = (): string | undefined => configuredGameDir() ?? session.current?.dir;

    // Built once and shared: the resolver is also the value this returns to the binary editor, and the picker
    // needs both halves - search to find a string, resolve to show the one a typed number already names.
    const strrefResolver = createStrrefResolver(session, fallbackGameDir);
    const strrefSearch = createStrrefSearch(session, fallbackGameDir);
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
            game = session.ensureOpen(dir);
        } catch (error) {
            conlog(`ieResources: no game to scan at ${dir}: ${error instanceof Error ? error.message : String(error)}`);
            return;
        }
        scannedDir = dir;
        const controller = new AbortController();
        referenceScan = controller;
        // Deliberately not awaited: this returns to the caller immediately and the scan yields as it goes,
        // so opening a game costs exactly what it did before.
        void references.build(dlgSourceFor(game), controller.signal).catch((error: unknown) => {
            conlog(
                `ieResources: dialog reference scan failed: ${error instanceof Error ? error.message : String(error)}`,
            );
        });
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

    /**
     * Search the game's text for a string and write its number at the cursor. A strref is an opaque integer,
     * so the alternative is knowing it beforehand or hunting for it in another tool.
     */
    const insertGameString = async (): Promise<void> => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        const strref = await pickStrref(
            strrefSearch,
            (ref) => strrefResolver(editor.document.uri, ref),
            editor.document.uri,
            {
                title: "Insert a game string's number",
            },
        );
        if (strref === undefined) return;
        // Replaces the selection where there is one, matching what typing the number would do.
        await editor.edit((builder) => {
            for (const selection of editor.selections) builder.replace(selection, String(strref));
        });
    };

    context.subscriptions.push(
        { dispose: () => session.dispose() },
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
        vscode.commands.registerCommand("bgforge.ieResources.insertGameString", insertGameString),
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
        pickStrref: (uri, title) => pickStrref(strrefSearch, (ref) => strrefResolver(uri, ref), uri, { title }),
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
