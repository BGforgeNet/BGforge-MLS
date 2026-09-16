import * as path from "path";
import * as vscode from "vscode";
import { type Rgba, applyCreatureColors, isRgbaAnimation } from "@bgforge/image";
import type { CreatureEntry } from "../ie-resources/creature-index";
import { backupHandle, warnBackupUnreadable } from "../hot-exit-backup";
import { SHARED_TILES_CSS, buildSharedWebviewHtml, sharedWebviewRoots } from "../webview-html";
import { surfaceWebviewRuntimeError } from "../webview-error";
import { type DocumentBackup, decodeBackup, encodeBackup } from "./backup";
import { type GameResourceBytes, ImageEditorDocument } from "./document";
import { type AnimationSetSource } from "./set-document";
import { planImageSave, pvrzPageWrites } from "./save";
import {
    type ActiveCreature,
    type SaveContext,
    confirmOverwrite,
    ensureBasePage,
    handleImport,
    handleSaveAs,
    lookupSet,
    pickSetFolder,
    planSave,
    runSave,
} from "./save-flow";
import { sidecarPalPath } from "./sidecar";
import { type AnimationSet, animationIdHex, setTitle } from "@bgforge/animation";
import { defaultPrefix, suggestTargetId } from "./conversion";
import { parseAnimationSetUri, parseResourceUri } from "../ie-resources/uri";
import { openAnimationSet } from "../ie-resources/open-set";
import {
    type AnimationView,
    type CreatureOption,
    type HostToWebview,
    type WebviewToHost,
    isWebviewToHost,
    packFramePixels,
} from "./webview/messages";

/**
 * The hot-exit backup for `backupId`, or undefined when there is none or it cannot be used.
 *
 * A decode failure is an EXPECTED condition here, not just a read failure: the container is versioned
 * precisely because a backup can outlive the extension version that wrote it. `decodeBackup` still refuses a
 * header it cannot read - only the caller's handling is forgiving, per the shared policy in
 * `warnBackupUnreadable`.
 */
async function readBackup(uri: vscode.Uri, backupId: string | undefined): Promise<DocumentBackup | undefined> {
    if (backupId === undefined) return undefined;
    try {
        return decodeBackup(await vscode.workspace.fs.readFile(vscode.Uri.parse(backupId)));
    } catch {
        warnBackupUnreadable(uri);
        return undefined;
    }
}

const WEBVIEW_DIR = path.join("client", "src", "image-editor", "webview");
const WEBVIEW_HTML = path.join(WEBVIEW_DIR, "index.html");
const WEBVIEW_CSS = path.join(WEBVIEW_DIR, "styles.css");
const WEBVIEW_JS = path.join("client", "out", "image-editor", "webview", "main.js");

/** An animation resref opens with a 4-character code naming the animation; the rest is variant and action. */
const ANIMATION_CODE_CHARS = 4;

/** A set as the host's quick pick offers it, in both set pickers. */
function setPickItem(set: AnimationSet): { label: string; description: string; id: number } {
    return {
        label: setTitle(set),
        // The id is what the tables key on, so it is the reader's own reference - and it is what makes two
        // sets sharing a name (a family's generations) tellable apart.
        description: animationIdHex(set.id),
        id: set.id,
    };
}

/**
 * The view an open (or a post-edit refresh) sends: geometry for every frame, pixels only for the one
 * each sequence shows first. Playback starts at frame 0, so that subset is exactly the first paint;
 * the webview asks for the rest as it needs them.
 *
 * MAPICONS.BAM is the case this exists for - 5888 frames decoding to 107 MB of RGBA, of which its
 * 183 cycles display 183 at a time.
 */
function initialView(document: ImageEditorDocument): AnimationView {
    const include = new Set<number>();
    for (const sequence of document.animation.sequences) {
        const first = sequence.frameRefs[0];
        if (first !== undefined) include.add(first);
    }
    return document.toView({ include });
}

/**
 * What it takes to draw an IE creature animation in a real creature's colours: the install's creatures, and
 * the gradient table their seven indices select from. Both are properties of the game, so both are asked per
 * document URI and answer undefined outside one.
 */
export interface CreatureColorSource {
    creatures: (uri: vscode.Uri) => readonly CreatureEntry[] | undefined;
    gradients: (uri: vscode.Uri) => readonly (readonly Rgba[])[] | undefined;
}

/**
 * The two things that differ between the surfaces this protocol is spoken on.
 *
 * The animation UI is one implementation drawn in two places - an editor tab, which is a VS Code document,
 * and the gallery panel, which is not. Everything else about them is identical by construction; these two
 * questions have genuinely different answers, because only a document has VS Code's save behind it and only
 * the gallery has a list to move the selection within.
 */
export interface AnimationSurface {
    /** Persist the open document where it came from. */
    save(document: ImageEditorDocument): Promise<void>;
    /** Show another set of the same install here. */
    showSet(gameDir: string, id: number): Promise<void>;
}

/**
 * One surface's end of the animation protocol.
 *
 * A `vscode.Webview` would nearly do, except that the gallery speaks this protocol and its own down one
 * channel and so has to wrap and unwrap; asking for the two directions instead lets it.
 */
export interface AnimationChannel {
    post(message: HostToWebview): void;
    /**
     * The handler's promise is RETURNED to the caller, not dropped. VS Code ignores it, but a message that
     * writes files is only finished when it settles, and a channel that swallowed it would leave every
     * caller unable to tell a completed save from a started one.
     */
    onMessage(handler: (message: WebviewToHost) => Promise<void>): vscode.Disposable;
}

/** The plain case: a webview showing nothing but this. */
export function webviewChannel(webview: vscode.Webview): AnimationChannel {
    return {
        post: (message) => void webview.postMessage(message),
        onMessage: (handler) =>
            webview.onDidReceiveMessage((message: unknown) =>
                // Malformed or unknown-shape message: ignore rather than act on partial data.
                isWebviewToHost(message) ? handler(message) : undefined,
            ),
    };
}

/**
 * Custom editor for Fallout FRM / Infinity Engine BAM animations. Unlike the binary editor,
 * `@bgforge/image` is a pure, fast in-process library - no worker thread is needed, and the
 * provider calls it directly from the extension host.
 */
export class ImageEditorProvider implements vscode.CustomEditorProvider<ImageEditorDocument> {
    static readonly viewType = "bgforge.animationEditor";

    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<
        vscode.CustomDocumentEditEvent<ImageEditorDocument>
    >();
    readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

    /**
     * Open channel-to-document map, for broadcasting a refresh to every surface showing a document.
     *
     * Keyed by channel rather than by panel because the gallery draws this UI inside a panel of its own
     * that shows other things too - the protocol, not the window, is what the two surfaces share.
     */
    private readonly active = new Map<AnimationChannel, ImageEditorDocument>();

    private readonly extensionUri: vscode.Uri;

    /**
     * `resourceBytes` reads the open game's resources, used to resolve a BAM v2's PVRZ pages when
     * they are not siblings of the opened file. Absent when the resource viewer is not registered.
     */
    private readonly resourceBytes: GameResourceBytes | undefined;

    /** Absent when the resource viewer is not registered, which is also every non-IE context. */
    private readonly creatureColors: CreatureColorSource | undefined;

    /** Resolves an animation set the editor is asked to open. Absent outside the resource viewer, as above. */
    private readonly animationSets: AnimationSetSource | undefined;

    /** Asks once before a set save replaces several override files. Absent as above. */
    private readonly confirmGroupWrite: ((uris: readonly vscode.Uri[]) => Promise<void>) | undefined;

    /** The creature each document is being shown as, if any. Per document, so every panel of one agrees. */
    private readonly activeCreature = new WeakMap<ImageEditorDocument, ActiveCreature>();

    /** The two collaborators the save/export/import flows read, bound once - see `save-flow.ts`. */
    private readonly saveContext: SaveContext;

    constructor(
        context: vscode.ExtensionContext,
        resourceBytes?: GameResourceBytes,
        creatureColors?: CreatureColorSource,
        animationSets?: AnimationSetSource,
        confirmGroupWrite?: (uris: readonly vscode.Uri[]) => Promise<void>,
    ) {
        this.resourceBytes = resourceBytes;
        this.creatureColors = creatureColors;
        this.animationSets = animationSets;
        this.confirmGroupWrite = confirmGroupWrite;
        this.extensionUri = context.extensionUri;
        this.saveContext = { animationSets, activeCreature: this.activeCreature };
    }

    async openCustomDocument(
        uri: vscode.Uri,
        openContext: vscode.CustomDocumentOpenContext,
        _token: vscode.CancellationToken,
    ): Promise<ImageEditorDocument> {
        // A hot-exit restore hands back the backup written by backupCustomDocument, whose payload carries
        // the unsaved edits; reading the files instead would silently discard them while the editor still
        // shows as dirty.
        const backup = await readBackup(uri, openContext.backupId);
        const document = await this.openDocument(uri, backup);
        document.onDidChangeCustomDocument((event) => this._onDidChangeCustomDocument.fire(event));
        return document;
    }

    /**
     * Open a document against this provider's game resources, wired to redraw the surfaces showing it.
     *
     * Public because the gallery opens documents too. The edit-stack forwarding above is NOT part of it:
     * that is what makes a tab dirty and asks to save on close, which a panel has no standing to do.
     */
    async openDocument(uri: vscode.Uri, backup?: DocumentBackup): Promise<ImageEditorDocument> {
        const document = await ImageEditorDocument.open(uri, backup, this.resourceBytes, this.animationSets);
        // Before the first view is built: the declared palette is what a colour variant IS, so a document
        // shown once without it would draw as whichever variant the shared art was saved under.
        const read = this.resourceBytes;
        if (read !== undefined) document.applyDeclaredPalette((resref, ext) => read(uri, resref, ext));
        document.onDidRefresh(() => this.postToDocumentPanels(document, { type: "init", view: initialView(document) }));
        return document;
    }

    /** Persist a document in place - the write behind both the tab's save and the gallery's. */
    async saveDocument(document: ImageEditorDocument): Promise<void> {
        await this.writeSave(document, document.saveUri, { inPlace: true });
    }

    async resolveCustomEditor(
        document: ImageEditorDocument,
        panel: vscode.WebviewPanel,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        panel.webview.options = {
            enableScripts: true,
            localResourceRoots: sharedWebviewRoots(this.extensionUri, WEBVIEW_DIR),
        };
        panel.webview.html = this.getHtml(panel.webview);

        const attached = this.attach(document, webviewChannel(panel.webview), {
            // Through VS Code's own save so its dirty tracking clears - scoped to this document's URI, so
            // it saves the right one even if focus moved since the click.
            save: async (doc) => {
                await vscode.workspace.save(doc.uri);
            },
            // A set IS this document's address, so another set is another document - and opening it this
            // way leaves the reader the one they came from.
            showSet: (gameDir, id) => openAnimationSet((dir) => this.animationSets?.list(dir), gameDir, id),
        });
        panel.onDidDispose(() => attached.dispose());
    }

    /**
     * Speak the animation protocol on a webview, for as long as it lives.
     *
     * The seam the gallery reaches this editor through: it owns a webview of its own and drives the same
     * components with the same messages, so the two surfaces are one implementation rather than a viewer
     * and an editor that would drift apart on the first change to either.
     */
    attach(document: ImageEditorDocument, channel: AnimationChannel, surface: AnimationSurface): vscode.Disposable {
        this.active.set(channel, document);
        const subscription = channel.onMessage(async (message) => {
            try {
                await this.handleWebviewMessage(document, channel, message, surface);
            } catch (error) {
                this.post(channel, { type: "error", message: error instanceof Error ? error.message : String(error) });
            }
        });
        return new vscode.Disposable(() => {
            subscription.dispose();
            this.active.delete(channel);
        });
    }

    /** The animation code a BAM's own name puts it in: an animation resref is `<4-char code><variant><action>`. */
    private animationCodeOf(document: ImageEditorDocument): string {
        return path.parse(document.uri.path).name.slice(0, ANIMATION_CODE_CHARS).toUpperCase();
    }

    /**
     * The creatures offered for this document, the ones actually using its animation first.
     *
     * Both halves are listed rather than only the matching ones: an install shares one animation between
     * hundreds of creatures, so the matching set is a useful default and not a small one, and borrowing a
     * palette from an unrelated creature is a legitimate thing to want.
     */
    /**
     * The creatures to offer, and whether a game answered at all.
     *
     * Both, because an empty list means two different things and the webview branches on which: the
     * resolver returns undefined where no install could be resolved and an empty array for an install that
     * lists no creatures. Collapsing the two here is what made the picker's note tell a reader with a game
     * open to go and open one.
     */
    private creatureOptions(document: ImageEditorDocument): { entries: CreatureOption[]; gameOpen: boolean } {
        const index = this.creatureColors?.creatures(document.uri);
        const code = this.animationCodeOf(document);
        const options = (index ?? []).map((entry) => ({
            resref: entry.resref,
            name: entry.name,
            matches: entry.animationCode !== "" && entry.animationCode === code,
        }));
        // Matching first, then by name so the list reads alphabetically within each half; a creature the
        // string table cannot name sorts by its resref, which is all it has.
        const entries = options.sort((a, b) => {
            if (a.matches !== b.matches) return a.matches ? -1 : 1;
            return (a.name || a.resref).localeCompare(b.name || b.resref);
        });
        return { entries, gameOpen: index !== undefined };
    }

    /** The document's own palette - what it shows with no creature chosen. Empty for a palette-less BAM v2. */
    private basePalette(document: ImageEditorDocument): Rgba[] {
        const animation = document.animation;
        return isRgbaAnimation(animation) ? [] : animation.palette.map((c) => ({ ...c }));
    }

    /** The chosen creature's resolved palette, or undefined to go back to the animation's own colours. */
    private resolveCreature(document: ImageEditorDocument, resref: string | null): ActiveCreature | undefined {
        if (resref === null || this.creatureColors === undefined) return undefined;
        const animation = document.animation;
        // A BAM v2 carries per-pixel colour and no palette, so there is nothing for a creature to recolour.
        if (isRgbaAnimation(animation)) return undefined;
        const entry = this.creatureColors.creatures(document.uri)?.find((e) => e.resref === resref);
        const gradients = this.creatureColors.gradients(document.uri);
        if (entry === undefined || gradients === undefined) return undefined;
        return {
            resref: entry.resref,
            name: entry.name,
            palette: applyCreatureColors(animation.palette, gradients, entry.colors),
        };
    }

    private async handleWebviewMessage(
        document: ImageEditorDocument,
        channel: AnimationChannel,
        message: WebviewToHost,
        surface: AnimationSurface,
    ): Promise<void> {
        switch (message.type) {
            case "ready":
                // Before the decode, not after: this is what tells the webview's deadline that the
                // host is alive, and building the view is the part that outlasts the budget.
                this.post(channel, { type: "loading" });
                this.post(channel, { type: "init", view: initialView(document) });
                break;
            case "requestFrames": {
                const all = document.animation.frames;
                // Pairs, not two lists filtered separately: the webview zips `indices` to `frames` by
                // position, so anything that can shorten one without the other silently maps every later
                // frame onto the wrong index. Indexing is the whole check - a non-integer, a negative and
                // an out-of-range index all miss the array alike.
                const answered = message.indices.flatMap((index) => {
                    const frame = Number.isInteger(index) && index >= 0 ? all[index] : undefined;
                    return frame ? [{ index, frame }] : [];
                });
                const { frames, pixels } = packFramePixels(answered.map((a) => a.frame));
                this.post(channel, { type: "frames", indices: answered.map((a) => a.index), frames, pixels });
                break;
            }
            case "selectSetStance":
            case "selectSetArmour": {
                const pick =
                    message.type === "selectSetStance"
                        ? document.selectSetStance(message.key)
                        : document.selectSetArmour(message.level);
                if (pick === "changed") {
                    this.postToDocumentPanels(document, { type: "init", view: initialView(document) });
                    break;
                }
                if (pick === "unchanged") break;
                // A refusal reposts the view AND says so: the picker offers what the archive's index lists,
                // and a file listed there can still be undecodable - a control that silently snapped back
                // would leave the reader thinking the click missed.
                this.post(channel, { type: "init", view: initialView(document) });
                this.post(channel, { type: "error", message: "That part of the set could not be drawn." });
                break;
            }
            case "pickSet":
                await this.pickSet(document, surface);
                break;
            case "openDrawnBy":
                await this.openDrawnBy(document, surface);
                break;
            case "beginSaveAs": {
                const found = lookupSet(this.saveContext, document);
                if (found === undefined) break;
                this.post(channel, {
                    type: "saveAsSetup",
                    setup: {
                        id: found.set.id,
                        prefix: defaultPrefix(found.set),
                        targetId: suggestTargetId(found.set, this.animationSets?.list(found.gameDir) ?? []),
                        section: found.set.section ?? "",
                    },
                });
                break;
            }
            case "chooseSaveFolder": {
                const state = document.setState;
                if (state === undefined) break;
                const picked = await pickSetFolder(setTitle(state.set));
                // Answered either way: a dismissed picker has to reach the dialog, or its Choose button
                // sits waiting on a reply that is never coming.
                this.post(channel, { type: "saveFolder", ...(picked === undefined ? {} : { path: picked }) });
                break;
            }
            case "planSave": {
                const plan = await planSave(this.saveContext, document, message.request);
                if (plan !== undefined) this.post(channel, { type: "savePlan", plan });
                break;
            }
            case "runSave":
                await runSave(this.saveContext, document, message.request, (reply) => this.post(channel, reply));
                break;
            case "save":
                await surface.save(document);
                break;
            case "editMeta":
                document.applyMetaPatch(message.patch);
                break;
            case "setExternalPalette":
                document.setExternalPalette(message.enabled);
                break;
            case "requestCreatures": {
                this.post(channel, { type: "creatures", ...this.creatureOptions(document) });
                break;
            }
            case "openGame":
                // The same command the resource view's welcome offers, so the two ways in cannot drift.
                void vscode.commands.executeCommand("bgforge.ieResources.openGame");
                break;
            case "setCreature": {
                const active = this.resolveCreature(document, message.resref);
                if (active === undefined) this.activeCreature.delete(document);
                else this.activeCreature.set(document, active);
                this.postToDocumentPanels(document, {
                    type: "palette",
                    palette: active?.palette ?? this.basePalette(document),
                    creature: active?.resref,
                });
                break;
            }
            case "saveAs":
                await handleSaveAs(this.saveContext, document, message.target, message.paletteMode);
                break;
            case "import":
                await handleImport(document, message.mode);
                break;
            case "runtimeError": {
                const file = path.basename(document.uri.fsPath);
                surfaceWebviewRuntimeError({
                    editor: "Animation editor",
                    file,
                    message: message.message,
                    stack: message.stack,
                });
                break;
            }
        }
    }

    /**
     * Offer the install's animation sets and open the one chosen, in the tab it belongs in.
     *
     * The host's own quick pick rather than a control in the webview: an install declares hundreds of
     * sets, so this is a search, and the quick pick is the search this editor's readers already use for
     * every other resource. Where the pick then lands is the surface's - a tab opens the set as another
     * document, the gallery shows it in the one it has.
     */
    private async pickSet(document: ImageEditorDocument, surface: AnimationSurface): Promise<void> {
        const address = parseAnimationSetUri(document.uri);
        if (address === undefined || this.animationSets === undefined) return;
        const items = this.animationSets.list(address.gameDir).map((set) => setPickItem(set));
        if (items.length === 0) return;
        const picked = await vscode.window.showQuickPick(items, {
            title: "Show which animation set?",
            matchOnDescription: true,
        });
        if (picked === undefined || picked.id === address.id) return;
        await surface.showSet(address.gameDir, picked.id);
    }

    /**
     * Open the set drawing this game file, asking which only where several do - recoloured creatures and
     * class variants share their files, and which one is shown decides the palette and the stances.
     */
    private async openDrawnBy(document: ImageEditorDocument, surface: AnimationSurface): Promise<void> {
        const [only, ...rest] = document.drawnBy;
        if (only === undefined) return;
        const { gameDir } = parseResourceUri(document.uri);
        if (rest.length === 0) {
            await surface.showSet(gameDir, only.id);
            return;
        }
        const picked = await vscode.window.showQuickPick(
            document.drawnBy.map((set) => setPickItem(set)),
            {
                title: `Show which animation set drawing ${path.posix.basename(document.uri.path)}?`,
                matchOnDescription: true,
            },
        );
        if (picked !== undefined) await surface.showSet(gameDir, picked.id);
    }

    async saveCustomDocument(document: ImageEditorDocument, _token: vscode.CancellationToken): Promise<void> {
        await this.writeSave(document, document.saveUri, { inPlace: true });
    }

    async saveCustomDocumentAs(
        document: ImageEditorDocument,
        destination: vscode.Uri,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        await this.writeSave(document, destination);
    }

    async revertCustomDocument(document: ImageEditorDocument, _token: vscode.CancellationToken): Promise<void> {
        await document.reload();
        this.postToDocumentPanels(document, { type: "init", view: initialView(document) });
    }

    async backupCustomDocument(
        document: ImageEditorDocument,
        context: vscode.CustomDocumentBackupContext,
        _token: vscode.CancellationToken,
    ): Promise<vscode.CustomDocumentBackup> {
        await vscode.workspace.fs.writeFile(context.destination, encodeBackup(document.backup()));
        return backupHandle(context.destination);
    }

    /**
     * `inPlace` says this is the document saving itself rather than a Save As naming a destination.
     * Only the split-set arm needs it: a set's address is a `<base>.frm` no member write ever touches,
     * so a Save As aimed there is indistinguishable by address from an in-place save and would write
     * six files instead of the one named. A pair and a set address their real files, so for them the
     * destination still answers it.
     */
    private async writeSave(
        document: ImageEditorDocument,
        destination: vscode.Uri,
        options: { inPlace?: boolean } = {},
    ): Promise<void> {
        // A document combined from several files - an IE base/east pair, a Fallout `.fr0`-`.fr5` set -
        // saves in place by splitting back into those members; a Save As writes the single combined
        // form instead, which is the whole difference between saving this document and exporting it.
        if (destination.toString() === document.saveUri.toString()) {
            const setWrites = document.setSaveWrites();
            if (setWrites !== undefined) {
                // One question for the whole save: the writes land in the game's override folder, and a
                // per-file prompt would put the same modal up once per changed member.
                await this.confirmGroupWrite?.(setWrites.map((write) => write.uri));
                for (const write of setWrites) {
                    // eslint-disable-next-line no-await-in-loop
                    await vscode.workspace.fs.writeFile(write.uri, write.bytes);
                }
                // Said out loud because a set save writes files the reader never named: the tab says a set
                // was saved, and this says how much of the game it touched.
                const count = setWrites.length;
                vscode.window.setStatusBarMessage(`Saved ${count} animation ${count === 1 ? "file" : "files"}`, 3000);
                return;
            }
            const frSplitWrites = options.inPlace === true ? document.frSplitSaveWrites() : undefined;
            if (frSplitWrites !== undefined) {
                // Sequential by design: every `.frN` lands before the `.pal` sidecar, which comes last
                // so a crash never leaves a palette describing members that were never rewritten.
                for (const write of frSplitWrites) {
                    // eslint-disable-next-line no-await-in-loop
                    await vscode.workspace.fs.writeFile(write.uri, write.bytes);
                }
                return;
            }
            const pairWrites = document.pairSaveWrites();
            if (pairWrites) {
                // Sequential by design: the base lands before the companion so a crash never leaves a
                // fresh east file next to a stale base.
                for (const write of pairWrites) {
                    // eslint-disable-next-line no-await-in-loop
                    await vscode.workspace.fs.writeFile(write.uri, write.bytes);
                }
                return;
            }
        }
        const targetPath = destination.fsPath;
        // Defence in depth: the import path already answers this at the edit, so reaching here with
        // an unanswered page number means a new mutation path skipped it. Ask rather than let
        // serializeBamV2 throw - but a dismissal has to fail the save, since VS Code has already
        // committed to writing something.
        if (!(await ensureBasePage(document, document.needsFreshPages()))) {
            throw new Error("Save cancelled: a BAM v2 with edited frames needs a PVRZ page number.");
        }
        // A save that lands anywhere but the document's own file cannot rely on the PVRZ pages a
        // BAM v2 addresses being there, so it takes them along; an in-place save leaves them alone.
        const standalone = destination.toString() !== document.saveUri.toString();
        const { bytes, pages } = document.saveArtifacts({ standalone });
        const sidecarBytes = document.sidecarBytes();
        const sidecar = sidecarBytes ? { path: sidecarPalPath(targetPath), bytes: sidecarBytes } : undefined;
        const pageWrites = pvrzPageWrites(targetPath, pages);
        // The .bam itself is the destination VS Code already confirmed, but its pages are named by
        // page number and may belong to another animation in that folder - an in-place save included,
        // since a repack allocates numbers the user picked without seeing what the folder holds.
        if (pageWrites.length > 0 && !(await confirmOverwrite(pageWrites.map((write) => write.path)))) {
            throw new Error("Save cancelled: its PVRZ pages would overwrite files already in the folder.");
        }
        for (const write of planImageSave({ targetPath, bytes, sidecar, pages: pageWrites })) {
            // The primary artifact reuses the caller's URI (preserving its scheme); the sidecar and
            // any PVRZ pages are plain filesystem paths, same as the binary editor's writeSave. Only
            // an FRM has a sidecar, and an FRM is always a real file, so that stays a `file:` write.
            const target = write.path === targetPath ? destination : vscode.Uri.file(write.path);
            // Sequential by design: the main artifact lands before the .pal sidecar so a crash
            // never leaves a sidecar describing a palette for a file that was never written.
            // eslint-disable-next-line no-await-in-loop
            await vscode.workspace.fs.writeFile(target, write.bytes);
        }
    }

    private post(channel: AnimationChannel, message: HostToWebview): void {
        channel.post(message);
    }

    /** Post a message to every surface currently showing the given document. */
    private postToDocumentPanels(document: ImageEditorDocument, message: HostToWebview): void {
        for (const [channel, doc] of this.active) {
            if (doc === document) this.post(channel, message);
        }
    }

    private getHtml(webview: vscode.Webview): string {
        return buildSharedWebviewHtml(webview, {
            cacheKey: "animation-editor",
            extensionUri: this.extensionUri,
            html: WEBVIEW_HTML,
            js: WEBVIEW_JS,
            css: WEBVIEW_CSS,
            // The animation components' own layout, without which the rose draws its facings in one column.
            extraStyles: { "{{sharedTilesUri}}": SHARED_TILES_CSS },
        });
    }
}
