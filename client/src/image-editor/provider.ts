import * as path from "path";
import * as vscode from "vscode";
import {
    type Animation,
    type DirectionLayout,
    type IndexedAnimation,
    type Rgba,
    DEFAULT_FALLOUT_PALETTE,
    applyCreatureColors,
    convertToBamV2,
    importPngDirectory,
    isRgbaAnimation,
    LossReport,
    needsFreshPages,
    serializeBamV2,
} from "@bgforge/image";
import { type ImageDocumentModel } from "./document-model";
import { ieSchemeOf } from "@bgforge/image/ie-direction";
import type { CreatureEntry } from "../ie-resources/creature-index";
import { backupHandle, warnBackupUnreadable } from "../hot-exit-backup";
import { SHARED_TILES_CSS, buildSharedWebviewHtml, sharedWebviewRoots } from "../webview-html";
import { surfaceWebviewRuntimeError } from "../webview-error";
import { type DocumentBackup, decodeBackup, encodeBackup } from "./backup";
import { type GameResourceBytes, ImageEditorDocument } from "./document";
import { type AnimationSetSource, overridePathOf, setSaveSource } from "./set-document";
import { adaptImportedColourModel, buildCrossFormatSave, buildExport } from "./export-actions";
import { type SaveWrite, planImageSave, pvrzPageWrites } from "./save";
import {
    type SetDirectoryImport,
    type SetExportTarget,
    SET_MANIFEST_NAME,
    buildSetExport,
    isSetDirectory,
    matchSetImport,
    readSetDirectory,
    saveTargetOf,
    setExportLosses,
    setExportNeedsBasePage,
    setMemberPath,
    setMemberResrefs,
} from "./set-export";
import {
    type FrmShapePick,
    exportPaletteMode,
    ieGroupCount,
    needsCyclePick,
    reshapeImportToFrm,
    saveAsTargetPath,
    summarizeLoss,
} from "./save-as";
import { sidecarPalPath } from "./sidecar";
import {
    type ActionScheme,
    type AnimationSet,
    type StanceIo,
    FALLOUT_FRM,
    animationIdHex,
    declarationFiles,
    setTitle,
} from "@bgforge/animation";
import { type ConversionRequest, convertOpenSet, defaultPrefix, suggestTargetId } from "./conversion";
import { ieGroups } from "@bgforge/animation/group-labels";
import { parseAnimationSetUri } from "../ie-resources/uri";
import { openAnimationSet } from "../ie-resources/open-set";
import { ieGroupOptionText, offeredGroups } from "./webview/render/cycle-grouping";
import {
    type AnimationView,
    type SavePlanView,
    type SaveRequestView,
    type CreatureOption,
    type HostToWebview,
    type SaveAsTarget,
    type WebviewToHost,
    isWebviewToHost,
    packFramePixels,
    saveRequestKey,
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

/**
 * File names the save plan lists before it says "and N more".
 *
 * A character set is ninety-six names and a tiled one far more, so the list is a sample that proves the
 * naming took rather than an inventory - the total beside it is what says how many there are.
 */
const PLAN_NAMES_SHOWN = 8;

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
 * The creature whose colours a document is currently shown in. A VIEW state, deliberately not a document
 * edit: the animation's own palette keeps its placeholders, so the file saves back byte-identical and stays
 * recolourable by any creature. Export is the only place the choice is baked in.
 */
interface ActiveCreature {
    readonly resref: string;
    readonly name: string;
    readonly palette: Rgba[];
}

/**
 * What a dialog has already put to the reader before a set save runs.
 *
 * Its ABSENCE is what tells the save to ask for itself - the entry point that reaches one with no dialog
 * behind it. Present, every question the save could raise has been answered on a surface the reader was
 * looking at, and raising them again is a modal restating what they had just read and pressed Save on.
 */
interface SetSaveAnswers {
    destination: "override" | "folder";
    /** The folder picked in the dialog, for the destination that takes one. */
    folder?: string;
    /** The first PVRZ page, for the container that packs its frames into them. */
    basePage?: number;
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
    private creatureOptions(document: ImageEditorDocument): CreatureOption[] {
        const index = this.creatureColors?.creatures(document.uri) ?? [];
        const code = this.animationCodeOf(document);
        const options = index.map((entry) => ({
            resref: entry.resref,
            name: entry.name,
            matches: entry.animationCode !== "" && entry.animationCode === code,
        }));
        // Matching first, then by name so the list reads alphabetically within each half; a creature the
        // string table cannot name sorts by its resref, which is all it has.
        return options.sort((a, b) => {
            if (a.matches !== b.matches) return a.matches ? -1 : 1;
            return (a.name || a.resref).localeCompare(b.name || b.resref);
        });
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
            case "beginSaveAs": {
                const found = this.lookupSet(document);
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
                const picked = await ImageEditorProvider.pickSetFolder(setTitle(state.set));
                // Answered either way: a dismissed picker has to reach the dialog, or its Choose button
                // sits waiting on a reply that is never coming.
                this.post(channel, { type: "saveFolder", ...(picked === undefined ? {} : { path: picked }) });
                break;
            }
            case "planSave": {
                const plan = await this.planSave(document, message.request);
                if (plan !== undefined) this.post(channel, { type: "savePlan", plan });
                break;
            }
            case "runSave":
                await this.runSave(channel, document, message.request);
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
                this.post(channel, { type: "creatures", entries: this.creatureOptions(document) });
                break;
            }
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
                await this.handleSaveAs(document, message.target, message.paletteMode);
                break;
            case "import":
                await this.handleImport(document, message.mode);
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
     * The path Save As names its destination against, and the one gate on writing an export of a
     * document that is not a file. A resource read out of a game's archives has no containing folder
     * - its URI path is just `<resref>.<ext>` - so the usual "next to the source" name would put the
     * export at the root of the filesystem; ask for a folder instead. Undefined when the user
     * dismisses the picker, which cancels the save.
     */
    private async saveAsSourcePath(document: ImageEditorDocument): Promise<string | undefined> {
        if (document.uri.scheme === "file") return document.uri.fsPath;
        const basename = path.posix.basename(document.uri.path);
        const picked = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: "Save here",
            title: `Choose a folder for ${basename}`,
        });
        const dir = picked?.[0]?.fsPath;
        return dir === undefined ? undefined : path.join(dir, basename);
    }

    /**
     * The animation an export writes: the document's own, or its colours replaced by the chosen creature's.
     *
     * The one place the choice is baked in. Applied to the INDEXED animation before any conversion runs, so
     * the target sees the real colours as its source rather than a palette swapped in after a remap - which
     * would leave every index pointing at the wrong colour.
     */
    private exportColours(
        document: ImageEditorDocument,
        animation: IndexedAnimation,
    ): { animation: IndexedAnimation; creature: ActiveCreature | undefined } {
        const creature = this.activeCreature.get(document);
        if (creature === undefined) return { animation, creature: undefined };
        return { animation: { ...animation, palette: creature.palette }, creature };
    }

    /** The note an export carries when a creature's colours went into it. */
    private static bakedColoursNote(creature: ActiveCreature): string {
        const who = creature.name === "" ? creature.resref : `${creature.name} (${creature.resref})`;
        return `written in ${who}'s colours - the result cannot be recoloured as another creature`;
    }

    private async handleSaveAs(
        document: ImageEditorDocument,
        target: SaveAsTarget,
        paletteMode: "sidecar" | "nearest" | undefined,
    ): Promise<void> {
        try {
            if (document.setState !== undefined) {
                // A set has no single FRM - see the note on FRM in `set-export.ts`. Refused rather than
                // quietly writing the open stance, which is exactly the one-member-called-a-set the
                // set-scoped path below exists to stop.
                if (target === "frm") {
                    throw new Error(
                        'A whole set cannot be saved as one FRM. Use "Save as > Another game\'s files", ' +
                            "which asks for the name and id a Fallout critter set needs.",
                    );
                }
                await this.saveSetAs(document, target);
                return;
            }
            const sourcePath = await this.saveAsSourcePath(document);
            if (sourcePath === undefined) return; // user dismissed the destination picker
            const targetPath = saveAsTargetPath(sourcePath, target);

            // Save As auto-names its destination instead of showing a dialog, so overwrite consent
            // needs its own gate. In-place targets are exempt: BAMC's .bam collision is a deliberate
            // re-encode of the source (see saveAsTargetPath), and an IE pair's base member is what a
            // save writes anyway. A split set is NOT exempt: nothing writes its combined <base>.frm any
            // more, so one already there belongs to whoever made it and gets the usual prompt.
            const inPlace =
                targetPath === document.uri.fsPath || (!document.isFrSplit && targetPath === document.saveUri.fsPath);
            if (!inPlace && !(await this.confirmOverwrite([targetPath]))) return;

            if (target === "apng" || target === "png-directory") {
                // Both PNG targets hold everything either colour model does, so the animation goes
                // out as it is - no quantization, nothing to warn about. For an INDEXED document
                // that means resolvedAnimation, not animation: an FRM's own palette is an all-black
                // placeholder, and exporting the raw one writes black silhouettes (see document-model).
                const base = document.resolvedAnimation() ?? document.animation;
                // A PNG directory keeps its palette in each frame's own PLTE chunk and APNG is true
                // colour, so a creature's colours cross either one exactly - baked in, but not degraded.
                const exported = isRgbaAnimation(base)
                    ? { animation: base, creature: undefined }
                    : this.exportColours(document, base);
                if (exported.creature !== undefined) {
                    const note = ImageEditorProvider.bakedColoursNote(exported.creature);
                    const ok = await vscode.window.showWarningMessage(
                        "Converting will lose data.",
                        { modal: true, detail: `- ${note}` },
                        "Export anyway",
                    );
                    if (ok !== "Export anyway") return;
                }
                await this.writeAll(buildExport(exported.animation, target, targetPath));
                vscode.window.setStatusBarMessage(`Exported ${path.basename(targetPath)}${path.sep}`, 3000);
                return;
            }

            if (target === "bamv2") {
                await this.saveAsBamV2(document, targetPath);
                return;
            }

            // A true-colour document is quantized here; an indexed one comes back with its active
            // palette resolved. FRM's "nearest match" mode pins the palette so the colours make ONE
            // hop rather than being quantized and then remapped (see indexedForExport).
            const effectiveMode = exportPaletteMode(paletteMode, {
                target,
                creatureActive: this.activeCreature.get(document) !== undefined,
            });
            const { animation: converted, report: conversion } = document.indexedForExport({
                target,
                ...(target === "frm" && effectiveMode === "nearest" ? { palette: DEFAULT_FALLOUT_PALETTE } : {}),
            });
            const { animation: anim, creature } = this.exportColours(document, converted);

            // How the animation fills FRM's 6 rotations: an IE base file contributes one direction
            // block (asked by name when there are several), a non-directional animation one cycle for
            // all rotations. Undefined only when the user dismisses a picker.
            let pick: FrmShapePick | undefined = {};
            if (target === "frm") {
                // No section to name the direction blocks by: a set never reaches here - it is refused
                // above and sent to the conversion mode, which is what knows how to write Fallout files.
                pick = await this.resolveFrmShape(anim, path.basename(document.uri.fsPath));
                if (pick === undefined) return; // user dismissed the picker
            }
            const { writes, report } = buildCrossFormatSave(anim, target, targetPath, {
                paletteMode: effectiveMode,
                ...pick,
            });
            if (creature !== undefined) {
                report.add("creature-colours-baked", ImageEditorProvider.bakedColoursNote(creature));
            }
            // One warning for the whole journey: quantizing to indexed and then reshaping to the
            // target are two steps of one save, and the user is deciding about the result.
            report.absorb(conversion);
            if (!report.lossless) {
                const { message, detail } = summarizeLoss(report);
                const confirmed = await vscode.window.showWarningMessage(
                    message,
                    { modal: true, detail },
                    "Save anyway",
                );
                if (confirmed !== "Save anyway") return;
            }
            await this.writeAll(writes);
            vscode.window.setStatusBarMessage(`Saved ${path.basename(targetPath)}`, 3000);
        } catch (error) {
            // A save-as failure is a transient action error - surface it as a notification, NOT the
            // webview's fatal "Could not open file" state, which would wrongly blow away a working editor.
            void vscode.window.showErrorMessage(
                `Save failed: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    /**
     * The host's folder picker, for a set save.
     *
     * One implementation for both the dialog's Choose button and the entry point that has no dialog behind
     * it, so the two cannot ask differently for the same thing.
     */
    private static async pickSetFolder(title: string): Promise<string | undefined> {
        const picked = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: "Save the set here",
            title: `Where should ${title} be written?`,
        });
        return picked?.[0]?.fsPath;
    }

    /**
     * Save As for a whole set: every member of every armour level, into a folder the reader chooses.
     *
     * A folder rather than a name next to the source, because a set has no source file - its address is a
     * game and an id - and because the output is a dozen to eighty files that belong together. The
     * armour level on screen is not the scope: a character's levels are separate files under separate
     * prefixes, so exporting only the open one writes a fraction of the creature under a name that says
     * otherwise.
     */
    private async saveSetAs(
        document: ImageEditorDocument,
        target: SetExportTarget,
        asked?: SetSaveAnswers,
    ): Promise<void> {
        const state = document.setState;
        if (state === undefined) throw new Error("saveSetAs: not a set document");
        const { members, unreadable } = state.allMembers();
        if (members.length === 0) throw new Error("This install ships no readable files for this set.");
        const destination = asked?.destination ?? "folder";

        // Named before the destination is chosen: a reader who would rather fix the install than export a
        // partial creature should not have picked a folder first. Skipped where the dialog put the same
        // files in front of them already - a second modal saying what they just read is one to click past.
        if (
            asked === undefined &&
            unreadable.length > 0 &&
            !(await ImageEditorProvider.confirmPartialSet(unreadable))
        ) {
            return;
        }

        // The install's own override folder needs no prompt: it is where a plain Save already writes, and
        // the dialog named the path before the reader chose it. Only "a folder you choose" asks.
        // The game can close under an open tab, and an empty directory here composed `/override` at the
        // filesystem root - a plausible path, written to without a word.
        const gameDir = this.lookupSet(document)?.gameDir;
        if (destination === "override" && gameDir === undefined) {
            throw new Error("This set's game is no longer open, so there is no override folder to write into.");
        }
        // The dialog's own Choose button has already answered this where there was a dialog; only the
        // entry point without one still asks here.
        const chosen =
            destination === "override" && gameDir !== undefined
                ? overridePathOf(gameDir)
                : (asked?.folder ?? (await ImageEditorProvider.pickSetFolder(setTitle(state.set))));
        if (chosen === undefined) return;
        const folder = vscode.Uri.file(chosen);

        // Asked once for the whole set, not once per member: the pages are allocated in one run from this
        // number, so a per-member prompt would ask the same question a dozen times about one range. The
        // dialog asks it where there is one - a question arriving AFTER the folder picker reads as the save
        // having started, which is the wrong moment to be told a decision is still outstanding.
        let basePage = asked?.basePage;
        if (basePage === undefined && setExportNeedsBasePage(members, target)) {
            basePage = await this.pickBasePage(setTitle(state.set));
            if (basePage === undefined) return; // user dismissed the prompt
        }

        const creature = this.activeCreature.get(document);
        // The install this was read from, where one is still resolvable. Recorded in the manifest for the
        // reader; nothing on the import side keys off it.
        const flavour = this.lookupSet(document)?.flavour;
        const plan = buildSetExport({
            members,
            target,
            destDir: folder.fsPath,
            source: {
                id: state.set.id,
                title: setTitle(state.set),
                ...(flavour === undefined ? {} : { flavour }),
            },
            ...(creature === undefined ? {} : { palette: creature.palette }),
            ...(basePage === undefined ? {} : { basePage }),
        });

        // Same reasoning as the partial-set consent above: the dialog listed these losses before Save was
        // pressed, so asking again is a second answer to a question already answered. The overwrite consent
        // below is not that - what a folder already holds is not knowable until the folder is chosen.
        if (asked === undefined && !plan.report.lossless) {
            const { message, detail } = summarizeLoss(plan.report);
            const confirmed = await vscode.window.showWarningMessage(message, { modal: true, detail }, "Save anyway");
            if (confirmed !== "Save anyway") return;
        }
        // The last of the questions that used to arrive after Save. What a folder already holds is knowable
        // the moment one is chosen, and the dialog chooses one - so it says how many files it would replace
        // beside the names it would write, and pressing Save there is the consent.
        if (asked === undefined && !(await this.confirmOverwrite(plan.writes.map((write) => write.path)))) return;

        await this.writeAll(plan.writes);
        const pages = plan.pageCount > 0 ? ` and ${plan.pageCount} PVRZ page(s)` : "";
        vscode.window.setStatusBarMessage(
            `Saved ${members.length} file(s) of ${setTitle(state.set)}${pages} in ${path.basename(folder.fsPath)}`,
            3000,
        );
    }

    /** Consent for an export that cannot include every file, naming the ones it leaves out. */
    private static async confirmPartialSet(unreadable: readonly string[]): Promise<boolean> {
        const answer = await vscode.window.showWarningMessage(
            `${unreadable.length} file(s) of this set cannot be read and will be left out.`,
            { modal: true, detail: unreadable.join("\n") },
            "Export the rest",
        );
        return answer === "Export the rest";
    }

    /**
     * Save As a BAM v2: convert the animation into v2's shape, then write the `.bam` plus the PVRZ
     * pages its frames need. Unlike every other target this can require input - a page number - so it
     * lives in its own method rather than another branch of handleSaveAs.
     */
    private async saveAsBamV2(document: ImageEditorDocument, targetPath: string): Promise<void> {
        // resolvedAnimation for an indexed document: its active palette is what becomes the pixels,
        // and an FRM's own palette is an all-black placeholder (see document-model).
        const source = document.resolvedAnimation() ?? document.animation;
        // BAM v2 is true colour, so a chosen creature's palette becomes the pixels themselves.
        const coloured = isRgbaAnimation(source)
            ? { animation: source, creature: undefined }
            : this.exportColours(document, source);
        const { animation, report } = convertToBamV2(coloured.animation);
        if (coloured.creature !== undefined) {
            report.add("creature-colours-baked", ImageEditorProvider.bakedColoursNote(coloured.creature));
        }
        if (!report.lossless) {
            const { message, detail } = summarizeLoss(report);
            const confirmed = await vscode.window.showWarningMessage(message, { modal: true, detail }, "Save anyway");
            if (confirmed !== "Save anyway") return;
        }

        // Frames that came from a page can be written back against it; anything else needs pages of
        // its own, and which page numbers are free is a fact about the installation, not the file.
        // The document's own answer is reused where it has one, so a v2 edited and then saved as a
        // v2 is not asked the same question twice.
        let basePage: number | undefined;
        if (needsFreshPages(animation)) {
            if (!(await this.ensureBasePage(document, true))) return; // user dismissed the prompt
            basePage = document.chosenBasePage();
        }
        // No fresh pages needed means the frames are still the source file's, so its own pages come
        // along verbatim - the destination folder has none of them.
        const saved = serializeBamV2(animation, basePage === undefined ? { emitUnchangedPages: true } : { basePage });
        const pageWrites = pvrzPageWrites(targetPath, saved.pages);
        // The .bam already had its own gate above; the pages are a separate set of filenames, chosen
        // by page number rather than by the animation's name, so they need their own consent.
        if (!(await this.confirmOverwrite(pageWrites.map((write) => write.path)))) return;
        await this.writeAll(planImageSave({ targetPath, bytes: saved.bam, pages: pageWrites }));
        const pageCount = saved.pages.length;
        vscode.window.setStatusBarMessage(
            `Saved ${path.basename(targetPath)}${pageCount > 0 ? ` and ${pageCount} PVRZ page(s)` : ""}`,
            3000,
        );
    }

    /**
     * Make sure the document can name a first PVRZ page before anything needs one, asking once.
     *
     * Called at the EDIT that forces a repack rather than at the save, because three of the four
     * paths that serialize a document cannot ask: an in-place save, a native Save As, and a hot-exit
     * backup all run without a place to put a prompt. Answering here means none of them can meet a
     * document that cannot be written. False when the user dismisses the prompt.
     */
    private async ensureBasePage(document: ImageEditorDocument, needed: boolean): Promise<boolean> {
        if (!needed || document.chosenBasePage() !== undefined) return true;
        const basePage = await this.pickBasePage(path.basename(document.uri.fsPath));
        if (basePage === undefined) return false;
        document.setBasePage(basePage);
        return true;
    }

    /**
     * Ask which PVRZ page number to start at. Never defaulted: a number already taken by a page
     * inside the game's own BIF archives surfaces only as corrupted graphics at runtime, and only
     * the person doing the install knows which range their mod owns.
     */
    private async pickBasePage(fileName: string): Promise<number | undefined> {
        const answer = await vscode.window.showInputBox({
            title: `PVRZ page number for ${fileName}`,
            prompt: "The frames are written into MOS<nnnn>.PVRZ files starting at this number. Pick a range your mod owns - reusing a number the game already ships corrupts its graphics.",
            validateInput: (value) =>
                /^\d{1,4}$/.test(value.trim()) ? undefined : "Enter a page number between 0 and 9999.",
        });
        return answer === undefined ? undefined : Number(answer.trim());
    }

    /**
     * Resolve how a non-FRM shape fills FRM's 6 rotations. An IE base file (ie8 layout) converts one
     * direction block - its whole rose, minus the north/south cycles FRM has no slot for; a
     * non-directional multi-cycle animation converts one chosen cycle into all six rotations. Returns
     * an empty pick when no choice is needed, undefined when the user dismisses a picker.
     */
    private async resolveFrmShape(
        anim: IndexedAnimation,
        sourceName: string,
        /** The install's own name for this animation family, where the caller has one to label blocks by. */
        section?: string,
    ): Promise<FrmShapePick | undefined> {
        const groupCount = ieGroupCount(anim);
        if (groupCount !== undefined) {
            if (groupCount === 1) return { ieGroup: 0 };
            const ieGroup = await this.pickDirectionGroup(sourceName, groupCount, anim.meta.directionLayout, section);
            return ieGroup === undefined ? undefined : { ieGroup };
        }
        if (needsCyclePick(anim)) {
            const singleCycle = await this.pickCycle(anim.sequences.length);
            return singleCycle === undefined ? undefined : { singleCycle };
        }
        return {};
    }

    /** Ask which direction block a directional FRM should use; undefined if the user dismisses the
     *  picker. Options carry the same scheme names as the webview's group select. */
    private async pickDirectionGroup(
        sourceName: string,
        groupCount: number,
        layout: DirectionLayout | undefined,
        section: string | undefined,
    ): Promise<number | undefined> {
        const scheme = ieSchemeOf(layout);
        const blocks = ieGroups(sourceName, groupCount, scheme, section);
        // The offered blocks carry their own indices, so the pick maps back through them rather than by
        // its position in the list - a block the scheme addresses nothing to is left out, and taking the
        // position would then hand the caller the wrong block.
        const offered = offeredGroups(groupCount, blocks);
        const items = offered.map((index) => ieGroupOptionText(blocks, index, scheme));
        const picked = await vscode.window.showQuickPick(items, {
            title: "Which direction group should the FRM use? (its north/south cycles have no FRM rotation)",
        });
        return picked === undefined ? undefined : offered[items.indexOf(picked)];
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
        const items = this.animationSets.list(address.gameDir).map((set) => ({
            label: setTitle(set),
            // The id is what the tables key on, so it is the reader's own reference - and it is what
            // makes two sets sharing a name (a family's generations) tellable apart.
            description: animationIdHex(set.id),
            id: set.id,
        }));
        if (items.length === 0) return;
        const picked = await vscode.window.showQuickPick(items, {
            title: "Show which animation set?",
            matchOnDescription: true,
        });
        if (picked === undefined || picked.id === address.id) return;
        await surface.showSet(address.gameDir, picked.id);
    }

    /**
     * The open document's set, as the conversion needs it: the declaration, the archive it reads through,
     * and which install that is.
     *
     * Resolved per message rather than held: the game can close under an open tab, and a conversion run
     * against a stale archive would read bytes from an install that is no longer there.
     */
    private lookupSet(
        document: ImageEditorDocument,
    ): { gameDir: string; set: AnimationSet; io: StanceIo; flavour: string } | undefined {
        const address = parseAnimationSetUri(document.uri);
        if (address === undefined) return undefined;
        const found = this.animationSets?.lookup(address.gameDir, address.id);
        return found?.kind === "set" ? { gameDir: address.gameDir, ...found } : undefined;
    }

    /**
     * Whether a request rewrites the set for another shape, or writes it as it stands.
     *
     * Derived rather than chosen, which is what removed the separate save targets: the direction and
     * naming controls open on the set's OWN shape, so leaving them alone means the output keeps the
     * source's resrefs, and moving any of them is what mints new names under a new stem and id.
     */
    private isRetarget(document: ImageEditorDocument, request: SaveRequestView): boolean {
        const found = this.lookupSet(document);
        const source = document.setState === undefined ? undefined : setSaveSource(document.setState);
        if (source === undefined || found === undefined) return true;
        if (request.format === "frm") return true;
        if (request.format !== "bam") return false; // an image export reshapes nothing
        // The STEM counts as much as the shape. Renaming a set without reshaping it is a real thing to
        // want - the same creature under a new id - and it is a new animation just as much as a reshaped
        // one is: the files land under names the source's install does not use, so they need their own
        // declaration. Without this a rename silently wrote the source's own resrefs back.
        if (request.prefix !== "" && request.prefix !== defaultPrefix(found.set)) return true;
        // Only an axis the SOURCE states can be moved off it. A set whose layout no naming carries states
        // none - and the dialog still has to seed its controls with something, so comparing against the
        // absent value made every one of those sets a reshape and handed it to a converter that has no
        // reader for its layout. The section carries the SHAPE now, the two direction axes having been
        // derived from it rather than asked; an unstated axis still cannot differ.
        return (
            (source.section !== undefined && request.section !== source.section) ||
            (source.naming !== undefined && request.naming !== source.naming)
        );
    }

    /**
     * Why a request cannot be reshaped, where it cannot, so the plan says so instead of the write quietly
     * producing something else.
     *
     * The converter re-serializes each member as BAM v1, compressed or not - it has no BAM v2 writer, and a
     * request asking for one used to come back reporting the v1 files it had written as if they were what
     * was asked for. Writing the set AS IT STANDS does reach v2, which is what the reason points at.
     */
    private static retargetRefusal(request: SaveRequestView, retarget: boolean): string | undefined {
        if (!retarget || request.format !== "bam" || request.bamVersion !== 2) return undefined;
        return (
            "A reshaped set is written as BAM v1 - nothing here writes BAM v2 into a new layout. " +
            "Pick BAM v1, or write the set as it stands to get v2 files."
        );
    }

    /**
     * How many of the files a save would write are already in the chosen folder.
     *
     * Read as ONE directory listing rather than a stat per name: a character set is eighty files and the
     * plan is answered on every control the dialog has. Undefined where the folder could not be read at
     * all, which the plan says rather than reporting an empty folder that was never looked into.
     *
     * This is why the write no longer stops to ask for overwrite consent: what a folder already holds
     * becomes knowable the moment one is chosen, and the dialog chooses one.
     */
    private static async alreadyThere(folder: string, names: readonly string[]): Promise<number | undefined> {
        let entries: [string, vscode.FileType][];
        try {
            entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(folder));
        } catch {
            return undefined;
        }
        // Case-insensitively: an install's own files are upper case and a save writes what the target
        // names, so a folder holding `MDKNG1.BAM` is one a write of `MDKNG1.bam` lands on.
        const there = new Set(entries.map(([name]) => name.toLowerCase()));
        return names.filter((name) => there.has(name.toLowerCase())).length;
    }

    /**
     * What the plan says about a destination that already holds files, or nothing to say.
     *
     * Nothing until a folder is picked - "a folder you choose" is not a place that can be looked into - and
     * nothing when it is empty of these names, which is the ordinary case and needs no line of its own.
     */
    private static async overwriteNotes(destination: string, names: readonly string[]): Promise<string[]> {
        if (!destination.startsWith("/")) return [];
        const found = await ImageEditorProvider.alreadyThere(destination, names);
        if (found === undefined) return [`${destination} could not be read, so what it already holds is unknown.`];
        if (found === 0) return [];
        return [`${found} of these files are already in that folder and will be replaced.`];
    }

    /** The conversion this request names, for the two paths that both need it. */
    private static conversionRequestOf(request: SaveRequestView, fallbackPrefix: string): ConversionRequest {
        return {
            engine: request.format === "frm" ? "fallout" : "infinity",
            section: request.section,
            naming: request.format === "frm" ? "fallout-critter" : (request.naming as ActionScheme),
            prefix: request.prefix === "" ? fallbackPrefix : request.prefix,
            targetId: request.targetId,
            notes: request.notes,
            ...(request.unevenRotations === undefined ? {} : { unevenRotations: request.unevenRotations }),
            ...(request.format === "bam" && request.bamVersion === 1
                ? { container: request.compressed ? ("bamc" as const) : ("bam" as const) }
                : {}),
        };
    }

    /**
     * What the chosen settings would write, where, and what they would cost.
     *
     * Answered for EVERY destination rather than for a conversion alone, because the dialog shows the same
     * preview whichever one is picked - and a reader deciding between them is deciding on the file names,
     * which is exactly what differs.
     */
    private async planSave(document: ImageEditorDocument, request: SaveRequestView): Promise<SavePlanView | undefined> {
        const state = document.setState;
        const found = this.lookupSet(document);
        if (state === undefined || found === undefined) return undefined;
        const key = saveRequestKey(request);
        const retarget = this.isRetarget(document, request);
        // A retarget lands in a folder of the reader's own whatever the destination radio says, so the
        // preview names the folder it will ask for rather than the one that is no longer on offer.
        // The folder the reader picked, named: "a folder you choose" is not a destination anyone can check,
        // and checking it is the whole reason the picker moved into the dialog.
        const destination =
            request.destination === "override" && !retarget
                ? overridePathOf(found.gameDir)
                : (request.folder ?? "a folder you choose");

        const unsupported = ImageEditorProvider.retargetRefusal(request, retarget);
        if (unsupported !== undefined) {
            return {
                for: key,
                outcome: "refused",
                reason: unsupported,
                losses: [],
                notes: [],
                shown: [],
                files: 0,
                destination,
                retarget,
                needsBasePage: false,
                unevenRotations: false,
            };
        }

        if (!retarget) {
            const { members, unreadable } = state.allMembers();
            const target = saveTargetOf(request);
            // Through the writer's own rule: a member composed from a pair goes back over both halves, and a
            // preview counting the members alone understates what lands by one file each.
            const names = members.flatMap((member) =>
                setMemberResrefs(member, target).map((resref) => path.basename(setMemberPath("", resref, target))),
            );
            // The manifest is what makes a directory export re-importable as a set, so it is one of the
            // files the reader is deciding about rather than an implementation detail of the write.
            if (target === "png-directory") names.unshift(SET_MANIFEST_NAME);
            const report = setExportLosses(members, target, this.activeCreature.get(document)?.palette);
            const lost = new Set(report.losses);
            const notes = report.items.filter((item) => !lost.has(item)).map((item) => item.detail);
            if (unreadable.length > 0) {
                notes.push(`${unreadable.length} file(s) cannot be read and are left out: ${unreadable.join(", ")}`);
            }
            // Each of these writes MORE than the entries named above - a folder of frames per member, or a
            // PVRZ page per block - and how many is not known until the write runs, so it is said rather
            // than counted wrong.
            if (target === "png-directory") notes.push("Each member is a folder of one PNG per frame.");
            if (target === "bamv2") notes.push("Each member also writes the MOS PVRZ pages its frames need.");
            notes.push(...(await ImageEditorProvider.overwriteNotes(destination, names)));
            return {
                for: key,
                outcome: report.lossless ? "lossless" : "lossy",
                losses: report.losses.map((item) => item.detail),
                notes,
                shown: names.slice(0, PLAN_NAMES_SHOWN),
                files: names.length,
                destination,
                retarget: false,
                needsBasePage: setExportNeedsBasePage(members, target),
                // Writing a set as it stands keeps each member's own cycle table, so nothing is equalised.
                unevenRotations: false,
            };
        }

        // Planned without the notes: they are written from the same report the plan reads, so rendering
        // them here would cost the whole document to show a preview nobody asked for.
        const result = convertOpenSet(found.set, found.io, found.flavour, {
            ...ImageEditorProvider.conversionRequestOf(request, defaultPrefix(found.set)),
            notes: false,
        });
        const names = result.writes.map((write) => `${write.resref}.${write.extension}`);
        return {
            for: key,
            notes: [...result.notes, ...(await ImageEditorProvider.overwriteNotes(destination, names))],
            outcome: result.outcome,
            ...(result.reason === undefined ? {} : { reason: result.reason }),
            losses: result.losses,
            shown: names.slice(0, PLAN_NAMES_SHOWN),
            files: names.length,
            destination,
            retarget: true,
            // A retarget is refused for BAM v2 above, and every other container it writes packs no pages.
            needsBasePage: false,
            // Read off the conversion that just ran rather than guessed at: which facings differ, and by
            // how much, is a property of this source that only the equalising step has looked at.
            unevenRotations: result.unevenRotations,
        };
    }

    /**
     * Write the set out under the chosen settings.
     *
     * The two paths differ in more than their bytes. Writing the set AS IT STANDS keeps every member's own
     * resref, so it can land in the install's own override folder and be the files the engine already
     * names. A RETARGET is a new animation nothing declares yet, so it lands in a folder of the reader's
     * own, with its declaration and notes beside it - dropping it into a game would put files there that
     * no table names, which the engine ignores and the next reader cannot account for.
     */
    private async runSave(
        channel: AnimationChannel,
        document: ImageEditorDocument,
        request: SaveRequestView,
    ): Promise<void> {
        // No try/catch here: the channel's own dispatcher already turns a throw into an error posted back
        // to the webview, and catching it a second time here swallowed exactly the write failures whose
        // whole point is to reach the reader with the member they stopped on.
        if (!this.isRetarget(document, request)) {
            await this.saveSetAs(document, saveTargetOf(request), {
                destination: request.destination,
                ...(request.folder === undefined ? {} : { folder: request.folder }),
                ...(request.basePage === undefined ? {} : { basePage: request.basePage }),
            });
            return;
        }
        await this.runRetarget(channel, document, request);
    }

    private async runRetarget(
        channel: AnimationChannel,
        document: ImageEditorDocument,
        request: SaveRequestView,
    ): Promise<void> {
        const found = this.lookupSet(document);
        if (found === undefined) return;
        // The plan disables Save on this, but the check is here too: a run reaching the converter with a
        // container it cannot write would produce files that are not what was asked for and say nothing.
        const unsupported = ImageEditorProvider.retargetRefusal(request, true);
        if (unsupported !== undefined) {
            this.post(channel, { type: "error", message: unsupported });
            return;
        }
        const converted = ImageEditorProvider.conversionRequestOf(request, defaultPrefix(found.set));
        const result = convertOpenSet(found.set, found.io, found.flavour, converted);
        if (result.outcome === "refused") {
            this.post(channel, { type: "error", message: result.reason ?? "This set cannot be converted." });
            return;
        }
        // Chosen in the dialog, where the reader saw the file names that will fill it. Asked here only for
        // a request that reached this with no dialog behind it.
        const chosen = request.folder ?? (await ImageEditorProvider.pickSetFolder(setTitle(found.set)));
        if (chosen === undefined) return;
        const folder = vscode.Uri.file(chosen);

        // Nothing is rolled back on a failed write: the destination is a folder of the reader's own, which
        // can already hold files this run did not put there. The report carries the state instead - which
        // member stopped it, and what is in the folder now.
        // Every file the run means to write, not the members alone: the declaration and the notes are part
        // of what a reader gets, so a report counting only the art would understate what is missing.
        const declarations = declarationFiles({
            // The target the conversion actually wrote for, carried out of it - the declaration describes
            // that same shape, and a second resolution here is how the two come to disagree.
            target: result.target ?? FALLOUT_FRM,
            targetId: request.targetId,
            prefix: converted.prefix,
            section: request.section,
            naming: converted.naming,
            ...(found.set.prefixByArmour.size > 1 ? { armourLevels: found.set.prefixByArmour.size } : {}),
        });
        const total = result.writes.length + declarations.length + (result.notesFile === undefined ? 0 : 1);

        const written: string[] = [];
        const stopped = (name: string, error: unknown): Error => {
            const cause = error instanceof Error ? error.message : String(error);
            const listed = written.length === 0 ? "" : ` (${written.join(", ")})`;
            const rest = written.length === total ? "" : "; the rest were not written";
            return new Error(
                `${name} could not be written: ${cause}. ${folder.fsPath} now holds ${written.length} of ` +
                    `${total} files${listed}${rest}.`,
            );
        };
        const write = async (name: string, bytes: Uint8Array): Promise<void> => {
            try {
                await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, name), bytes);
            } catch (error) {
                throw stopped(name, error);
            }
            written.push(name);
        };
        for (const member of result.writes) {
            // eslint-disable-next-line no-await-in-loop -- sequential so a failure names the file it stopped on
            await write(`${member.resref}.${member.extension}`, member.bytes);
        }
        // The declaration itself, precomputed rather than described: the notes used to tell the reader to
        // write this by hand from values only this side knew. The east flag comes from the same choice that
        // stored the east, since the engine reads that flag rather than looking for the files.
        for (const file of declarations) {
            // eslint-disable-next-line no-await-in-loop -- as above
            await write(file.name, new TextEncoder().encode(file.text));
        }
        if (result.notesFile !== undefined) {
            await write(`${converted.prefix}-notes.md`, new TextEncoder().encode(result.notesFile));
        }
        void vscode.window.showInformationMessage(
            `Wrote ${setTitle(found.set)}: ${written.length} ${written.length === 1 ? "file" : "files"} in ` +
                `${folder.fsPath}.`,
        );
    }

    /** Ask which cycle a single-orientation FRM should use; undefined if the user dismisses the picker. */
    private async pickCycle(cycleCount: number): Promise<number | undefined> {
        const items = Array.from({ length: cycleCount }, (_, i) => `Cycle ${i}`);
        const picked = await vscode.window.showQuickPick(items, {
            title: "This animation has no directions - which cycle should the single-orientation FRM use?",
        });
        return picked === undefined ? undefined : items.indexOf(picked);
    }

    private async handleImport(document: ImageEditorDocument, mode: "replace" | "append"): Promise<void> {
        try {
            // Design choice: PNG-directory is the only import path. APNG is export/preview-only - see
            // the "import" message note in webview/messages.ts for why.
            const next = await this.importPngDirectory();
            if (!next) return;

            // A folder carrying a set manifest is a whole set, and applying it to the open member alone
            // would drop every other member of it on the floor. A set folder's own member directories are
            // ordinary animation directories, so pointing this at one of THOSE still imports that one.
            if (next.set !== undefined) {
                await this.importSet(document, next.set, mode);
                return;
            }

            // A directory carries its own colour model, which need not be the document's. Matching
            // them up front keeps replaceSequences a pure splice, and puts the one lossy direction
            // (true-colour PNGs into an indexed document) behind the same confirmation as a save.
            const adapted = adaptImportedColourModel(next.animation, document.animation);
            if (!adapted.report.lossless) {
                const { detail } = summarizeLoss(adapted.report);
                const confirmed = await vscode.window.showWarningMessage(
                    "Importing will lose data.",
                    { modal: true, detail },
                    "Import anyway",
                );
                if (confirmed !== "Import anyway") return;
            }

            // An FRM is a fixed 6-rotation format, so an import INTO one is reshaped to a valid FRM
            // (a direction block or a single chosen cycle, per resolveFrmShape) and always REPLACES -
            // otherwise an in-place Save would serialize the non-FRM shape into a malformed .frm
            // (rotations 1-5 empty while the header claims frames). A BAM accepts arbitrary cycles, so
            // its import applies unchanged.
            if (document.animation.meta.sourceFormat === "frm") {
                const indexed = adapted.animation;
                if (isRgbaAnimation(indexed)) throw new Error("handleImport: an FRM document adapted to true colour");
                const pick = await this.resolveFrmShape(indexed, next.name, document.setState?.set.section);
                if (pick === undefined) return; // user dismissed the picker
                document.replaceSequences(reshapeImportToFrm(indexed, pick), "replace");
                return;
            }
            // Imported frames come from PNGs, so no PVRZ page describes them and the save that
            // follows must allocate. Asked BEFORE the splice, not after: dismissing then cancels the
            // import outright rather than leaving behind a document that cannot be saved at all.
            if (!(await this.ensureBasePage(document, isRgbaAnimation(document.animation)))) return;
            document.replaceSequences(adapted.animation, mode);
        } catch (error) {
            void vscode.window.showErrorMessage(
                `Import failed: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    private async importPngDirectory(): Promise<
        { animation: Animation; name: string; set?: SetDirectoryImport } | undefined
    > {
        // Accept EITHER the export folder or its manifest.json - both resolve to the same directory,
        // whose frames are read relative to manifest.json. A set export's own `set.json` is accepted the
        // same way, so the two kinds of folder are picked identically.
        const selection = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: true,
            canSelectMany: false,
            filters: { "Exported animation manifest": ["json"] },
            openLabel: "Import",
            title: "Import a PNG directory or an exported set - pick its folder or its manifest",
        });
        const picked = selection?.[0];
        if (!picked) return undefined;

        const stat = await vscode.workspace.fs.stat(picked);
        const dir = stat.type === vscode.FileType.Directory ? picked : vscode.Uri.file(path.dirname(picked.fsPath));

        // Sanity check the selection BEFORE reading the tree: an export is defined by a manifest at its
        // top. Guide the user to the right pick instead of leaking a codec's internal throw, and avoid
        // recursively slurping an unrelated folder they picked by mistake.
        const isSet = await this.fileExists(vscode.Uri.joinPath(dir, SET_MANIFEST_NAME));
        if (!isSet && !(await this.fileExists(vscode.Uri.joinPath(dir, "manifest.json")))) {
            void vscode.window.showWarningMessage(
                `"${path.basename(dir.fsPath)}" is not an exported animation (no manifest.json or ` +
                    `${SET_MANIFEST_NAME} inside). Pick the folder written by "Save as > PNG directory", ` +
                    `or one of its manifests.`,
            );
            return undefined;
        }

        try {
            const files = await this.readDirectoryTree(dir);
            const name = path.basename(dir.fsPath); // feeds the group-pick labels
            if (isSetDirectory(files)) {
                const set = readSetDirectory(files);
                // The first member stands in for `animation`, which only the single-file path below reads;
                // the set path takes every member from `set`.
                const first = set.members[0];
                if (first === undefined) throw new Error("readSetDirectory: this export names no members");
                return { animation: first.animation, name, set };
            }
            return { animation: importPngDirectory(files), name };
        } catch (error) {
            // Malformed/incompatible manifest or a missing frame PNG - surface the cause, not a stack.
            const detail =
                error instanceof Error
                    ? error.message.replace(/^(importPngDirectory|readSetDirectory):\s*/, "")
                    : String(error);
            void vscode.window.showWarningMessage(`Can't import "${path.basename(dir.fsPath)}": ${detail}`);
            return undefined;
        }
    }

    /**
     * Apply an exported set folder to the open set, member by member.
     *
     * Refused outright for a single-file document: a set folder holds a dozen animations, and there is no
     * defensible answer to which of them one open file should become.
     */
    private async importSet(
        document: ImageEditorDocument,
        imported: SetDirectoryImport,
        mode: "replace" | "append",
    ): Promise<void> {
        const state = document.setState;
        if (state === undefined) {
            throw new Error(
                `"${imported.source.title}" is a whole exported set. Open the set it belongs to, or pick ` +
                    "one member folder inside it to import that member alone.",
            );
        }
        const open = state.allMembers().members;
        const match = matchSetImport(imported.members, open);
        if (match.matched.length === 0) {
            throw new Error(`None of the files in "${imported.source.title}" belong to the open set.`);
        }
        // Both mismatched directions are put to the reader together: a partial import is a legitimate
        // thing to want, and a silent one is the thing that looks like a whole-set import and is not.
        if (match.missing.length > 0 || match.unknown.length > 0) {
            const detail = [
                ...match.missing.map((resref) => `- ${resref}: nothing in the folder replaces it`),
                ...match.unknown.map((resref) => `- ${resref}: in the folder, not in this set`),
            ].join("\n");
            const answer = await vscode.window.showWarningMessage(
                `This folder covers ${match.matched.length} of the set's ${open.length} files.`,
                { modal: true, detail },
                "Import those",
            );
            if (answer !== "Import those") return;
        }

        // Each member is adapted against ITS OWN model: one set can mix colour models, and adapting the
        // whole import against the open member's would quantize the others to the wrong thing.
        const parts: { model: ImageDocumentModel; animation: Animation }[] = [];
        const report = new LossReport();
        for (const { member, animation } of match.matched) {
            const adapted = adaptImportedColourModel(animation, member.model.animation);
            report.absorb(adapted.report);
            parts.push({ model: member.model, animation: adapted.animation });
        }
        if (!report.lossless) {
            const { detail } = summarizeLoss(report);
            const confirmed = await vscode.window.showWarningMessage(
                "Importing will lose data.",
                { modal: true, detail },
                "Import anyway",
            );
            if (confirmed !== "Import anyway") return;
        }
        document.replaceSetSequences(parts, mode);
        vscode.window.setStatusBarMessage(`Imported ${parts.length} file(s) of ${setTitle(state.set)}`, 3000);
    }

    /**
     * Consent for every file a save is about to replace, naming them.
     *
     * A BAM v2 save writes N+1 files - the `.bam` plus one `MOSxxxx.PVRZ` per page - and the pages
     * are the half nothing used to ask about. Their names come from page NUMBERS, not from the
     * animation's, so they collide with whatever else in that folder happens to use the same range:
     * a Save As carries the source's own numbers into a folder that may already have them, and a
     * repack allocates from a base page the user picked without seeing the folder's contents.
     */
    private async confirmOverwrite(paths: readonly string[]): Promise<boolean> {
        const checked = await Promise.all(
            paths.map(async (p) => ({ name: path.basename(p), exists: await this.fileExists(vscode.Uri.file(p)) })),
        );
        const existing = checked.filter((entry) => entry.exists).map((entry) => entry.name);
        if (existing.length === 0) return true;
        const answer = await vscode.window.showWarningMessage(
            existing.length === 1
                ? `${existing[0]} already exists - overwrite?`
                : `${existing.length} files already exist - overwrite?`,
            { modal: true, ...(existing.length > 1 ? { detail: existing.join("\n") } : {}) },
            "Overwrite",
        );
        return answer === "Overwrite";
    }

    /** True when the path already exists (file or directory) - the Save As overwrite check and the
     *  sidecar-manifest probe both ask this. */
    private async fileExists(uri: vscode.Uri): Promise<boolean> {
        try {
            await vscode.workspace.fs.stat(uri);
            return true;
        } catch {
            // stat throws for an absent path as well as an unreadable one; both mean nothing is here to
            // overwrite, which is what the caller asked.
            return false;
        }
    }

    /** Recursively reads a directory into a relative-path Map, the shape `importPngDirectory` expects. */
    private async readDirectoryTree(root: vscode.Uri, prefix = ""): Promise<Map<string, Uint8Array>> {
        const files = new Map<string, Uint8Array>();
        const entries = await vscode.workspace.fs.readDirectory(root);
        for (const [name, type] of entries) {
            const childUri = vscode.Uri.joinPath(root, name);
            const relativePath = prefix ? `${prefix}/${name}` : name;
            if (type === vscode.FileType.Directory) {
                // eslint-disable-next-line no-await-in-loop
                const nested = await this.readDirectoryTree(childUri, relativePath);
                for (const [nestedPath, bytes] of nested) files.set(nestedPath, bytes);
            } else {
                // eslint-disable-next-line no-await-in-loop
                files.set(relativePath, await vscode.workspace.fs.readFile(childUri));
            }
        }
        return files;
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
        if (!(await this.ensureBasePage(document, document.needsFreshPages()))) {
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
        if (pageWrites.length > 0 && !(await this.confirmOverwrite(pageWrites.map((write) => write.path)))) {
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

    /** Writes an arbitrary set of paths, creating each write's parent directory first - needed for
     *  multi-file exports (png-directory nests a subdirectory per sequence) where the selected
     *  destination folder does not yet contain the sequence subdirectories. createDirectory has
     *  mkdirp semantics and is a no-op when the directory already exists. */
    private async writeAll(writes: SaveWrite[]): Promise<void> {
        // Create each unique parent directory once (createDirectory is mkdirp + idempotent), then write
        // every file in parallel. A per-file sequential create+write made a 60-file PNG-directory export
        // visibly slow over the remote filesystem (directories appearing one by one); this is two fan-outs.
        const dirs = [...new Set(writes.map((write) => path.dirname(write.path)))];
        await Promise.all(dirs.map((dir) => vscode.workspace.fs.createDirectory(vscode.Uri.file(dir))));
        await Promise.all(
            writes.map((write) => vscode.workspace.fs.writeFile(vscode.Uri.file(write.path), write.bytes)),
        );
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
