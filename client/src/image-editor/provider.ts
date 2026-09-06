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
    needsFreshPages,
    serializeBamV2,
} from "@bgforge/image";
import { ieSchemeOf } from "@bgforge/image/ie-direction";
import type { CreatureEntry } from "../ie-resources/creature-index";
import { backupHandle, warnBackupUnreadable } from "../hot-exit-backup";
import { generateNonce, getCachedHtmlAsset, getCachedJsAsset, inlineWebviewScript } from "../webview-assets";
import { surfaceWebviewRuntimeError } from "../webview-error";
import { type DocumentBackup, decodeBackup, encodeBackup } from "./backup";
import { type GameResourceBytes, ImageEditorDocument } from "./document";
import { type AnimationSetSource } from "./set-document";
import { adaptImportedColourModel, buildCrossFormatSave, buildExport } from "./export-actions";
import { type SaveWrite, planImageSave, pvrzPageWrites } from "./save";
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
import { type AnimationSet, type StanceIo, animationIdHex, setTitle } from "@bgforge/animation";
import { CONVERSION_PROFILES, convertOpenSet, defaultPrefix, suggestTargetId } from "./conversion";
import { ieGroupLabels } from "@bgforge/animation/group-labels";
import { parseAnimationSetUri } from "../ie-resources/uri";
import { openAnimationSet } from "../ie-resources/open-set";
import { ieGroupOptionText } from "./webview/render/cycle-grouping";
import {
    type AnimationView,
    type ConversionRequestView,
    type CreatureOption,
    type HostToWebview,
    type SaveAsTarget,
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
const SHARED_UI_DIR = path.join("client", "src", "webview-ui");
const SHARED_UI_BASE_CSS = path.join(SHARED_UI_DIR, "base.css");
const SHARED_UI_CSS = path.join(SHARED_UI_DIR, "primitives.css");
/** The animation components' own layout, without which the rose draws its facings in one column. */
const SHARED_TILES_CSS = path.join(SHARED_UI_DIR, "animation-tiles.css");
const CODICONS_DIR = path.join("client", "out", "codicons");

/** An animation resref opens with a 4-character code naming the animation; the rest is variant and action. */
const ANIMATION_CODE_CHARS = 4;

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

    /** Open panel-to-document map, for broadcasting a refresh to every panel showing a document. */
    private readonly active = new Map<vscode.WebviewPanel, ImageEditorDocument>();

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
        const document = await ImageEditorDocument.open(uri, backup, this.resourceBytes, this.animationSets);
        document.onDidChangeCustomDocument((event) => this._onDidChangeCustomDocument.fire(event));
        document.onDidRefresh(() => this.postToDocumentPanels(document, { type: "init", view: initialView(document) }));
        return document;
    }

    async resolveCustomEditor(
        document: ImageEditorDocument,
        panel: vscode.WebviewPanel,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        const codiconsDir = vscode.Uri.joinPath(this.extensionUri, CODICONS_DIR);
        const webviewDir = vscode.Uri.joinPath(this.extensionUri, WEBVIEW_DIR);
        const sharedUiDir = vscode.Uri.joinPath(this.extensionUri, SHARED_UI_DIR);
        panel.webview.options = { enableScripts: true, localResourceRoots: [codiconsDir, webviewDir, sharedUiDir] };
        panel.webview.html = this.getHtml(panel.webview);

        this.active.set(panel, document);
        panel.onDidDispose(() => this.active.delete(panel));

        panel.webview.onDidReceiveMessage(async (message: unknown) => {
            if (!isWebviewToHost(message)) {
                // Malformed or unknown-shape message: ignore rather than act on partial data.
                return;
            }
            try {
                await this.handleWebviewMessage(document, panel, message);
            } catch (error) {
                this.post(panel, { type: "error", message: error instanceof Error ? error.message : String(error) });
            }
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
        panel: vscode.WebviewPanel,
        message: WebviewToHost,
    ): Promise<void> {
        switch (message.type) {
            case "ready":
                // Before the decode, not after: this is what tells the webview's deadline that the
                // host is alive, and building the view is the part that outlasts the budget.
                this.post(panel, { type: "loading" });
                this.post(panel, { type: "init", view: initialView(document) });
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
                this.post(panel, { type: "frames", indices: answered.map((a) => a.index), frames, pixels });
                break;
            }
            case "selectSetAction":
            case "selectSetArmour": {
                const pick =
                    message.type === "selectSetAction"
                        ? document.selectSetAction(message.resref)
                        : document.selectSetArmour(message.level);
                if (pick === "changed") {
                    this.postToDocumentPanels(document, { type: "init", view: initialView(document) });
                    break;
                }
                if (pick === "unchanged") break;
                // A refusal reposts the view AND says so: the picker offers what the archive's index lists,
                // and a file listed there can still be undecodable - a control that silently snapped back
                // would leave the reader thinking the click missed.
                this.post(panel, { type: "init", view: initialView(document) });
                this.post(panel, { type: "error", message: "That part of the set could not be drawn." });
                break;
            }
            case "pickSet":
                await this.pickSet(document);
                break;
            case "beginConversion": {
                const found = this.lookupSet(document);
                if (found === undefined) break;
                this.post(panel, {
                    type: "conversionSetup",
                    setup: {
                        profiles: CONVERSION_PROFILES.map((profile) => ({ id: profile.id, label: profile.label })),
                        prefix: defaultPrefix(found.set),
                        targetId: suggestTargetId(found.set, this.animationSets?.list(found.gameDir) ?? []),
                    },
                });
                break;
            }
            case "planConversion": {
                const found = this.lookupSet(document);
                if (found === undefined) break;
                // Planned without the notes: they are written from the same report the plan reads, so
                // rendering them here would cost the whole document to show a preview nobody asked for.
                const result = convertOpenSet(found.set, found.io, found.flavour, {
                    profileId: message.profileId,
                    prefix: "",
                    targetId: 0,
                    notes: false,
                });
                this.post(panel, {
                    type: "conversionPlan",
                    plan: {
                        profileId: message.profileId,
                        outcome: result.outcome,
                        ...(result.reason === undefined ? {} : { reason: result.reason }),
                        losses: result.losses,
                        notes: result.notes,
                        files: result.writes.length,
                    },
                });
                break;
            }
            case "runConversion":
                await this.runConversion(panel, document, message.request);
                break;
            case "save":
                // Route through VS Code's own save so its dirty tracking clears - scoped to this
                // document's URI, so it saves the right one even if focus moved since the click.
                await vscode.workspace.save(document.uri);
                break;
            case "editMeta":
                document.applyMetaPatch(message.patch);
                break;
            case "setExternalPalette":
                document.setExternalPalette(message.enabled);
                break;
            case "requestCreatures": {
                this.post(panel, { type: "creatures", entries: this.creatureOptions(document) });
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
            const sourcePath = await this.saveAsSourcePath(document);
            if (sourcePath === undefined) return; // user dismissed the destination picker
            const targetPath = saveAsTargetPath(sourcePath, target);

            // Save As auto-names its destination instead of showing a dialog, so overwrite consent
            // needs its own gate. In-place targets are exempt: BAMC's .bam collision is a deliberate
            // re-encode of the source (see saveAsTargetPath), and a split set's combined <base>.frm
            // is overwrite-by-design (see document.saveUri).
            const inPlace = targetPath === document.uri.fsPath || targetPath === document.saveUri.fsPath;
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
    private async resolveFrmShape(anim: IndexedAnimation, sourceName: string): Promise<FrmShapePick | undefined> {
        const groupCount = ieGroupCount(anim);
        if (groupCount !== undefined) {
            if (groupCount === 1) return { ieGroup: 0 };
            const ieGroup = await this.pickDirectionGroup(sourceName, groupCount, anim.meta.directionLayout);
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
    ): Promise<number | undefined> {
        const scheme = ieSchemeOf(layout);
        const labels = ieGroupLabels(sourceName, groupCount, scheme);
        const items = Array.from({ length: groupCount }, (_, i) => ieGroupOptionText(labels, i, scheme));
        const picked = await vscode.window.showQuickPick(items, {
            title: "Which direction group should the FRM use? (its north/south cycles have no FRM rotation)",
        });
        return picked === undefined ? undefined : items.indexOf(picked);
    }

    /**
     * Offer the install's animation sets and open the one chosen, in the tab it belongs in.
     *
     * The host's own quick pick rather than a control in the webview: an install declares hundreds of
     * sets, so this is a search, and the quick pick is the search this editor's readers already use for
     * every other resource. Opening rather than swapping the document: a set IS the document's address,
     * so another set is another document - and this way the reader keeps the one they came from.
     */
    private async pickSet(document: ImageEditorDocument): Promise<void> {
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
        await openAnimationSet((dir) => this.animationSets?.list(dir), address.gameDir, picked.id);
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
     * Write a converted set out, into a folder the reader chooses.
     *
     * A folder rather than the game's own override: a converted set is a new animation nothing declares
     * yet, and landing it in an install would put files there that no table names - which the engine
     * ignores and the next reader cannot account for. The notes file beside them says what to declare.
     */
    private async runConversion(
        panel: vscode.WebviewPanel,
        document: ImageEditorDocument,
        request: ConversionRequestView,
    ): Promise<void> {
        const found = this.lookupSet(document);
        if (found === undefined) return;
        const result = convertOpenSet(found.set, found.io, found.flavour, request);
        if (result.outcome === "refused") {
            this.post(panel, { type: "error", message: result.reason ?? "This set cannot be converted." });
            return;
        }
        const [folder] =
            (await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                openLabel: "Convert into this folder",
                title: `Where should ${setTitle(found.set)} be written?`,
            })) ?? [];
        if (folder === undefined) return;

        for (const write of result.writes) {
            const uri = vscode.Uri.joinPath(folder, `${write.resref}.${write.extension}`);
            // eslint-disable-next-line no-await-in-loop -- sequential so a failure names the file it stopped on
            await vscode.workspace.fs.writeFile(uri, write.bytes);
        }
        if (result.notesFile !== undefined) {
            const stem = request.prefix === "" ? defaultPrefix(found.set) : request.prefix;
            await vscode.workspace.fs.writeFile(
                vscode.Uri.joinPath(folder, `${stem}-notes.md`),
                new TextEncoder().encode(result.notesFile),
            );
        }
        const count = result.writes.length;
        void vscode.window.showInformationMessage(
            `Converted ${setTitle(found.set)}: ${count} ${count === 1 ? "file" : "files"} in ${folder.fsPath}.`,
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
                const pick = await this.resolveFrmShape(indexed, next.name);
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

    private async importPngDirectory(): Promise<{ animation: Animation; name: string } | undefined> {
        // Accept EITHER the export folder or its manifest.json - both resolve to the same directory,
        // whose frames are read relative to manifest.json.
        const selection = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: true,
            canSelectMany: false,
            filters: { "PNG-directory manifest": ["json"] },
            openLabel: "Import",
            title: "Import PNG directory - pick its folder or its manifest.json",
        });
        const picked = selection?.[0];
        if (!picked) return undefined;

        const stat = await vscode.workspace.fs.stat(picked);
        const dir = stat.type === vscode.FileType.Directory ? picked : vscode.Uri.file(path.dirname(picked.fsPath));

        // Sanity check the selection BEFORE reading the tree: a PNG-directory export is defined by its
        // manifest.json. Guide the user to the right pick instead of leaking the codec's internal throw,
        // and avoid recursively slurping an unrelated folder they picked by mistake.
        const manifestUri = vscode.Uri.joinPath(dir, "manifest.json");
        if (!(await this.fileExists(manifestUri))) {
            void vscode.window.showWarningMessage(
                `"${path.basename(dir.fsPath)}" is not a PNG-directory export (no manifest.json inside). ` +
                    `Pick the folder written by "Save as > PNG directory", or its manifest.json.`,
            );
            return undefined;
        }

        try {
            // The directory name feeds the group-pick labels (the export keeps the source's basename).
            return {
                animation: importPngDirectory(await this.readDirectoryTree(dir)),
                name: path.basename(dir.fsPath),
            };
        } catch (error) {
            // Malformed/incompatible manifest or a missing frame PNG - surface the cause, not a stack.
            const detail =
                error instanceof Error ? error.message.replace(/^importPngDirectory:\s*/, "") : String(error);
            void vscode.window.showWarningMessage(`Can't import "${path.basename(dir.fsPath)}": ${detail}`);
            return undefined;
        }
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
        // A Fallout .fr0-.fr5 split set saves to the combined <base>.frm (document.saveUri), never
        // back to the opened .frN member; the six split files are left untouched.
        await this.writeSave(document, document.saveUri);
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

    private async writeSave(document: ImageEditorDocument, destination: vscode.Uri): Promise<void> {
        // An IE base/east pair saves in place by splitting back into its two member files; a Save As
        // to another destination falls through and writes the single combined form instead.
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

    private post(panel: vscode.WebviewPanel, message: HostToWebview): void {
        void panel.webview.postMessage(message);
    }

    /** Post a message to every webview panel currently showing the given document. */
    private postToDocumentPanels(document: ImageEditorDocument, message: HostToWebview): void {
        for (const [panel, doc] of this.active) {
            if (doc === document) this.post(panel, message);
        }
    }

    private getHtml(webview: vscode.Webview): string {
        const extensionPath = this.extensionUri.fsPath;
        let html = getCachedHtmlAsset("animation-editor", extensionPath, WEBVIEW_HTML);
        // See docs/architecture.md (Webview CSP): styles load as <link> stylesheets resolved
        // through asWebviewUri and authorised by `style-src {{cspSource}}`, not inlined with a
        // nonce - the wrapped webview silently drops a nonce-only style-src.
        const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, WEBVIEW_CSS));
        const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, CODICONS_DIR, "codicon.css"));
        const baseUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, SHARED_UI_BASE_CSS));
        const primitivesUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, SHARED_UI_CSS));
        // Function replacers: the URIs contain `$`-adjacent characters that String.replace would
        // otherwise interpret as `$&`/`$'` patterns.
        html = html.replace("{{stylesUri}}", () => stylesUri.toString());
        html = html.replace("{{sharedStylesUri}}", () =>
            webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, SHARED_TILES_CSS)).toString(),
        );
        html = html.replace("{{codiconsUri}}", () => codiconsUri.toString());
        html = html.replace("{{baseUri}}", () => baseUri.toString());
        html = html.replace("{{primitivesUri}}", () => primitivesUri.toString());
        const script = getCachedJsAsset("animation-editor", extensionPath, WEBVIEW_JS);
        const nonce = generateNonce();
        html = inlineWebviewScript(html, script, nonce);
        return html.replaceAll("{{cspSource}}", webview.cspSource);
    }
}
