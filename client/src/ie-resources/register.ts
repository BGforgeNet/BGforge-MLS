import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { conlog } from "../logging";
import { GameResourceFileSystemProvider } from "./fs-provider";
import { GameSession } from "./session";
import { GameResourceTreeProvider, type ResourceNode } from "./tree-provider";
import { createSlotLabelResolver, createStrrefResolver, type SlotLabelResolver, type StrrefResolver } from "./strref";
import { GAME_RESOURCE_SCHEME, resourceUri } from "./uri";

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
            openLabel: "Open IE Game",
            title: "Select the game's chitin.key",
        });
        const keyFile = picked?.[0]?.fsPath;
        if (keyFile) await openGameDir(path.dirname(keyFile));
    };

    const openResource = async (element?: ResourceNode): Promise<void> => {
        const current = session.current;
        if (!current || !element) return;
        // Some KEY entries point at archives that are not installed (e.g. developer BIFs like PROGTEST.BIF).
        // Fail gracefully with a clear message instead of opening an editor that then errors on the missing read.
        if (!current.game.canRead(element.resref, element.ext)) {
            void vscode.window.showWarningMessage(
                `${element.resref}.${element.ext} is unavailable: its archive is not installed in this game.`,
            );
            return;
        }
        const uri = resourceUri(current.dir, element.resref, element.ext);
        // Binary record formats open in the structured binary editor; every other resource opens in the default
        // editor, where text formats (2da/ids/baf/d/tra/tp2/...) render as text and VS Code shows its binary
        // notice for opaque blobs (bam/mos/wav/...). Both read through the game-resource FS provider.
        if (element.openable) {
            await vscode.commands.executeCommand("vscode.openWith", uri, "bgforge.binaryEditor");
        } else {
            await vscode.commands.executeCommand("vscode.open", uri);
        }
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
    );

    // Restore the last-opened game (independent of the workspace) for continuity across reloads.
    const lastDir = context.workspaceState.get<string>(LAST_DIR_KEY);
    if (lastDir && fs.existsSync(path.join(lastDir, "chitin.key"))) {
        void openGameDir(lastDir);
    } else {
        void setHasGame(false);
    }

    return { strref: createStrrefResolver(session), slotLabel: createSlotLabelResolver(session) };
}
