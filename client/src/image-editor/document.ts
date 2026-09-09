import * as path from "path";
import * as vscode from "vscode";
import {
    type Animation,
    type BamV2PageWrite,
    type IndexedAnimation,
    type IndexedSourceFormat,
    type LossReport,
    type Rgba,
    type RgbaAnimation,
    combineFrmDirections,
    combineIeBamPair,
    encodeBamc,
    decodeBamV2,
    isBamV2,
    loadImage,
    pvrzResourceName,
    readBamV2Structure,
    readBmpPalette,
    serializeBamV1,
    serializeFrm,
    splitFrmDirections,
    splitIeBamBlocks,
    splitIeBamPair,
} from "@bgforge/image";
import type { DocumentBackup } from "./backup";
import { ImageDocumentModel } from "./document-model";
import { type AnimationSetSource, AnimationSetState, type SetPick, isEastPair, setView } from "./set-document";
import { parseAnimationSetUri, resourceUri } from "../ie-resources/uri";
import { animationIdHex, replacementPaletteNames } from "@bgforge/animation";
import { FR_SPLIT_MEMBERS, frSplitCombinedPath, frSplitSiblingPaths, isFrSplitPath } from "./fr-split";
import { baseCandidatePath, eastCompanionCandidates, isBamPath } from "./ie-pair";
import { composePvrzResolver } from "./pvrz-resolver";
import { sidecarPalPath } from "./sidecar";
import type { AnimationView, MetaPatch } from "./webview/messages";

/**
 * Reads a resource out of the game an editor document was opened against - `gameLookups.resourceBytes`
 * from the IE resource viewer, taken as a function so this module stays free of the archive layer.
 */
export type GameResourceBytes = (uri: vscode.Uri, resref: string, ext: string) => Uint8Array | undefined;

type BamFormat = "bam" | "bamc";

/**
 * One write of an in-place save that produces several files - a base/east pair, or a set's changed
 * members - addressed by URI so it lands back where its file was read.
 */
export interface ResourceWrite {
    uri: vscode.Uri;
    bytes: Uint8Array;
}

/**
 * The stored identity of an IE base/east pair: both members and each one's own encoding. URIs, not
 * filesystem paths, so a pair opened out of a game's archives keeps the scheme and query that route
 * a read or a write back to that game.
 */
interface IePairInfo {
    baseUri: vscode.Uri;
    eastUri: vscode.Uri;
    baseFormat: BamFormat;
    eastFormat: BamFormat;
}

function serializeBamAs(animation: IndexedAnimation, format: BamFormat): Uint8Array {
    const bytes = serializeBamV1(animation);
    return format === "bamc" ? encodeBamc(bytes) : bytes;
}

/**
 * Thin `vscode.CustomDocument` shell over `ImageDocumentModel`: owns the file identity, the
 * sidecar `.pal` read, and the two VS Code event emitters (edit stack + panel refresh). All
 * animation state and undo logic lives in the model.
 */
export class ImageEditorDocument implements vscode.CustomDocument {
    readonly uri: vscode.Uri;
    // True when the document was opened from a Fallout `.fr0`-`.fr5` split set: it is combined on
    // load and cut back into those six members on save (see fr-split.ts and frSplitSaveWrites).
    readonly isFrSplit: boolean;
    // Set when the document was opened from an IE base/east BAM pair (see ie-pair.ts): the pair is
    // combined on load into one full-rose animation and split back into both files on save.
    readonly iePair: IePairInfo | undefined;
    /**
     * Set when the document was opened on an animation set rather than a file: the set, the armour level
     * and the action currently shown. Swapping the action swaps the model, which is why it is not readonly.
     */
    readonly setState: AnimationSetState | undefined;
    private model: ImageDocumentModel;

    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<
        vscode.CustomDocumentEditEvent<ImageEditorDocument>
    >();
    readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

    private readonly _onDidRefresh = new vscode.EventEmitter<void>();
    readonly onDidRefresh = this._onDidRefresh.event;

    private constructor(
        uri: vscode.Uri,
        model: ImageDocumentModel,
        isFrSplit: boolean,
        iePair?: IePairInfo,
        setState?: AnimationSetState,
    ) {
        this.uri = uri;
        this.isFrSplit = isFrSplit;
        this.iePair = iePair;
        this.setState = setState;
        this.model = model;
        this.model.onChange = () => this._onDidRefresh.fire();
    }

    /**
     * Put another model behind this document - a set showing a different action, or one reloaded from the
     * game. The refresh hook moves with it: left on the old model, an edit made after the swap would fire a
     * panel refresh that redraws from the model nobody is looking at any more.
     */
    private useModel(model: ImageDocumentModel): void {
        if (model === this.model) return;
        this.model.onChange = undefined;
        this.model = model;
        this.model.onChange = () => this._onDidRefresh.fire();
        this.resolveDeclaredPalette();
    }

    /** How the open game answers a resource read, kept so a model swap can re-resolve the table below. */
    private paletteSource: ((resref: string, ext: string) => Uint8Array | undefined) | undefined;

    /**
     * Draw this document under the replacement colour table its animation declares, where the install
     * ships one. `read` fetches a resource from the open game.
     *
     * The declaration is the animation's, not the file's - the six colour dragons are one body under six
     * palettes - so it comes from the set rather than from anything the opened bytes carry. It is also per
     * MEMBER: a tiled family stores one table per stance group, so swapping groups swaps the table, and the
     * source is kept rather than the resolved palette.
     */
    applyDeclaredPalette(read: (resref: string, ext: string) => Uint8Array | undefined): void {
        this.paletteSource = read;
        this.resolveDeclaredPalette();
    }

    /**
     * Point the open model at the table its member declares, or at nothing where the install ships none -
     * which leaves the picture drawn under the palette its own file carries.
     */
    private resolveDeclaredPalette(): void {
        const state = this.setState;
        const read = this.paletteSource;
        if (state === undefined || read === undefined) return;
        // Stopping at the first hit rather than reading them all: the names are ordered by preference,
        // and the later ones are fallbacks an archive read would be spent on for nothing.
        let bytes: Uint8Array | undefined;
        for (const name of replacementPaletteNames(state.set, state.action.resref, state.armour)) {
            bytes = read(name, "bmp");
            if (bytes !== undefined) break;
        }
        this.model.useDeclaredPalette(bytes === undefined ? undefined : readBmpPalette(bytes));
    }

    /**
     * Opens `uri`, or restores it from `backup` when VS Code re-opens a document that was dirty at
     * shutdown. A restore takes only the animation from the backup: the split-set / pair identity and
     * the sidecar palette still come from disk, which the unsaved edits never touched.
     */
    static async open(
        uri: vscode.Uri,
        backup?: DocumentBackup,
        resourceBytes?: GameResourceBytes,
        animationSets?: AnimationSetSource,
    ): Promise<ImageEditorDocument> {
        const setAddress = parseAnimationSetUri(uri);
        if (setAddress !== undefined) {
            return ImageEditorDocument.openSet(uri, setAddress, animationSets, backup);
        }
        if (isFrSplitPath(uri.fsPath)) {
            const { animation, sidecarBytes } = await ImageEditorDocument.readFrSplit(uri.fsPath);
            // Present and save under the combined <base>.frm identity, not the opened .frN member.
            const basename = path.basename(frSplitCombinedPath(uri.fsPath));
            const model = backup
                ? ImageDocumentModel.fromBackup(backup, basename, sidecarBytes)
                : ImageDocumentModel.fromAnimation(animation, basename, sidecarBytes);
            return new ImageEditorDocument(uri, model, true);
        }
        const bytes = await vscode.workspace.fs.readFile(uri);
        if (isBamPath(uri.path)) {
            // A v2 backup carries its own pages, so the restore rebuilds from it rather than from
            // disk - the edited pages were never written there. Checked before the disk read below
            // for the same reason: re-reading would resurrect the pre-edit picture.
            if (backup && isBamV2(backup.bytes)) {
                return new ImageEditorDocument(
                    uri,
                    ImageDocumentModel.fromBackup(backup, path.basename(uri.fsPath)),
                    false,
                );
            }
            // v2 before the pair probe: pairing combines two BAM v1 files, and a v2 file cannot be
            // a member of one, so probing it first would read siblings for nothing.
            const v2 = await ImageEditorDocument.tryReadBamV2(uri, bytes, resourceBytes);
            if (v2) {
                return new ImageEditorDocument(
                    uri,
                    ImageDocumentModel.fromRgbaAnimation(v2, path.basename(uri.fsPath)),
                    false,
                );
            }
            const pair = await ImageEditorDocument.tryReadIePair(uri, bytes);
            if (pair) {
                // Present under the base file's identity, whichever member was opened.
                const basename = path.posix.basename(pair.info.baseUri.path);
                const model = backup
                    ? ImageDocumentModel.fromBackup(backup, basename)
                    : ImageDocumentModel.fromAnimation(pair.animation, basename);
                return new ImageEditorDocument(uri, model, false, pair.info);
            }
        }
        const sidecarBytes = await ImageEditorDocument.readSidecar(uri);
        const basename = path.basename(uri.fsPath);
        const model = backup
            ? ImageDocumentModel.fromBackup(backup, basename, sidecarBytes)
            : ImageDocumentModel.fromBytes(bytes, basename, sidecarBytes);
        return new ImageEditorDocument(uri, model, false);
    }

    /**
     * Open an animation set: its members are read from the game the URI names, not from a file.
     *
     * A failure here throws rather than opening an empty tab, because the two ways it can fail are both
     * worth saying out loud - the install is closed or is a different one, or it ships none of this
     * animation's files - and neither is something a blank editor would convey.
     *
     * A restore replays every member the backup carries over the freshly-resolved set - the whole set is
     * read from the game as usual, and the unsaved members are put back on top of it.
     */
    private static openSet(
        uri: vscode.Uri,
        address: { gameDir: string; id: number },
        animationSets?: AnimationSetSource,
        backup?: DocumentBackup,
    ): ImageEditorDocument {
        const hex = animationIdHex(address.id);
        const found = animationSets?.lookup(address.gameDir, address.id) ?? { kind: "no-game" };
        if (found.kind === "no-game") throw new Error(`Open ${address.gameDir} to show animation ${hex}.`);
        if (found.kind === "not-declared") throw new Error(`This game declares no animation ${hex}.`);
        const state = AnimationSetState.open(found.set, found.io);
        if (state === undefined) throw new Error(AnimationSetState.refusal(found.set, hex));
        for (const member of backup?.members ?? []) {
            state.restoreMember(
                member.resref,
                ImageDocumentModel.fromBackup(
                    { bytes: member.bytes, externalPalette: member.externalPalette },
                    `${member.resref}.BAM`,
                ),
            );
        }
        return new ImageEditorDocument(uri, state.model, false, undefined, state);
    }

    /**
     * The identity an in-place save is addressed by: the combined `<base>.frm` for a split set, the
     * base member for an IE pair, else the source. Neither multi-file form actually writes this file -
     * the provider recognises the address and splits the save across the real members instead - but
     * both need one name to be the document's own, and a set of six or a pair has no other.
     *
     * A URI rather than a path so the write lands back where the document was read from; only the
     * Fallout split set, which exists on a real filesystem by definition, names a `file:` path itself.
     */
    get saveUri(): vscode.Uri {
        if (this.isFrSplit) return vscode.Uri.file(frSplitCombinedPath(this.uri.fsPath));
        return this.iePair?.baseUri ?? this.uri;
    }

    /**
     * In-place save writes for an IE pair: the combined animation split back into its two files, each
     * serialized with its member's own encoding. Undefined for non-pair documents; throws when edits
     * broke the 8-slot block structure a split needs.
     */
    pairSaveWrites(): ResourceWrite[] | undefined {
        if (!this.iePair) return undefined;
        const indexed = this.model.indexedAnimation();
        // Pairing is a BAM v1 shape: a document only becomes a pair by combining two v1 files.
        if (indexed === undefined) throw new Error("A true-colour BAM has no base/east pair to split.");
        const split = splitIeBamPair(indexed);
        if (!split) {
            throw new Error(
                "This base/east BAM pair no longer fits the 8-cycle direction blocks - use Save As instead.",
            );
        }
        return [
            { uri: this.iePair.baseUri, bytes: serializeBamAs(split.base, this.iePair.baseFormat) },
            { uri: this.iePair.eastUri, bytes: serializeBamAs(split.east, this.iePair.eastFormat) },
        ];
    }

    /**
     * In-place save writes for a Fallout split set: the combined animation cut back into its six
     * `<base>.fr0`-`.fr5` members, then the `<base>.pal` sidecar the set is read alongside. Undefined
     * for a document not opened from a split set.
     *
     * A facing the animation draws nothing for is skipped rather than written frameless: an absent
     * member is how an incomplete set on disk reaches the editor, and writing one would add a file the
     * set never had. A combined `<base>.frm` an earlier version of this editor wrote is left alone -
     * it is a user file, and deleting one on save is not this editor's call.
     */
    frSplitSaveWrites(): ResourceWrite[] | undefined {
        if (!this.isFrSplit) return undefined;
        const indexed = this.model.indexedAnimation();
        // A split set is FRM, which carries a palette index per pixel; a true-colour model cannot arise.
        if (indexed === undefined) throw new Error("A true-colour animation has no .fr0-.fr5 members to split.");
        const paths = frSplitSiblingPaths(this.uri.fsPath);
        const writes = splitFrmDirections(indexed).flatMap((file, d): ResourceWrite[] => {
            const target = paths[d];
            if (target === undefined || file.frames.length === 0) return [];
            return [{ uri: vscode.Uri.file(target), bytes: serializeFrm(file) }];
        });
        const sidecarBytes = this.model.sidecarBytes();
        if (sidecarBytes === undefined) return writes;
        const sidecarUri = vscode.Uri.file(sidecarPalPath(frSplitCombinedPath(this.uri.fsPath)));
        return [...writes, { uri: sidecarUri, bytes: sidecarBytes }];
    }

    /**
     * In-place save writes for a set: one file per member the reader changed, addressed by its own
     * resource URI so each lands in the game it was read from. Undefined for a document that is not a set.
     *
     * Untouched members produce no write - a set is a dozen files, and copying all of them into the
     * override folder over one edit would put eleven unrequested copies there.
     *
     * A member drawn from a base file and its eastern twin is cut back along the same 8-slot blocks it was
     * composed on, and both halves are written. Anything else drawn from SEVERAL files throws: a split
     * picture (a quadrant animation's quarters, a tiled one's grid) leaves no record of where its seams
     * were, so writing it back would put the whole composition over the first quarter.
     */
    setSaveWrites(): ResourceWrite[] | undefined {
        const state = this.setState;
        if (state === undefined) return undefined;
        const address = parseAnimationSetUri(this.uri);
        // Unreachable - a set state exists only for a set URI - but stated rather than defaulted: a missing
        // game directory would address every write at the filesystem root instead of failing.
        if (address === undefined) throw new Error(`${this.uri.toString()} is not an animation set address.`);
        const { gameDir } = address;
        const write = (resref: string, bytes: Uint8Array): ResourceWrite => ({
            uri: resourceUri(gameDir, resref, "bam"),
            bytes,
        });
        return state.editedMembers().flatMap(({ action, model }): ResourceWrite[] => {
            const [base, east] = action.parts;
            if (action.parts.length === 1) return [write(action.resref, model.saveArtifacts().bytes)];
            // Through the shared predicate: which members are an eastern PAIR also decides how many facings
            // they store, and the two answers cannot be allowed to drift apart.
            if (isEastPair(action.parts) && base !== undefined && east !== undefined) {
                return ImageEditorDocument.eastPairWrites(base, east, model, state, write);
            }
            throw new Error(
                `${action.resref} is drawn from ${action.parts.length} files composed together, ` +
                    `which cannot be saved back in place - use Save As instead.`,
            );
        });
    }

    /**
     * A base file and its eastern twin, cut back out of the one model they were composed into.
     *
     * The split is by SLOT, not by where each frame came from: the composition keeps no record of that, and
     * the scheme's own rule - western facings in the base, eastern in the twin - says where each belongs.
     * A base whose stored table stopped short of the eastern slots gains them as empty cycles, which is the
     * shape the twin already ships and what the engine reads past.
     */
    private static eastPairWrites(
        base: string,
        east: string,
        model: ImageDocumentModel,
        state: AnimationSetState,
        write: (resref: string, bytes: Uint8Array) => ResourceWrite,
    ): ResourceWrite[] {
        const indexed = model.indexedAnimation();
        // A pair is a BAM v1 shape: both halves were parsed as one before they were composed.
        if (indexed === undefined) throw new Error(`${base} is true colour and has no base/east pair to split.`);
        const split = splitIeBamBlocks(indexed);
        if (split === undefined) {
            throw new Error(`${base} no longer fits the 8-cycle direction blocks its pair splits on.`);
        }
        return [
            write(base, serializeBamAs(split.base, state.storedFormat(base))),
            write(east, serializeBamAs(split.east, state.storedFormat(east))),
        ];
    }

    /**
     * A BAM v2's frames live in separate `MOSxxxx.PVRZ` pages, so opening one means resolving every
     * page it names before anything can be decoded. Returns undefined for a file that is not v2.
     *
     * Pages are read up front rather than lazily because `decodeBamV2` is synchronous and the two
     * sources here are not: the sibling read crosses `vscode.workspace.fs`, and the game lookup
     * goes through the archive layer.
     */
    private static async tryReadBamV2(
        uri: vscode.Uri,
        bytes: Uint8Array,
        resourceBytes?: GameResourceBytes,
    ): Promise<RgbaAnimation | undefined> {
        if (!isBamV2(bytes)) return undefined;

        const structure = readBamV2Structure(bytes);
        const dir = uri.with({ path: path.posix.dirname(uri.path) });
        // In parallel: a BAM referencing a dozen pages would otherwise pay a serial round-trip each,
        // and the reads are independent.
        const found = await Promise.all(
            structure.requiredPages.map(async (page): Promise<[string, Uint8Array] | undefined> => {
                const resource = pvrzResourceName(page);
                try {
                    return [resource, await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, resource))];
                } catch {
                    // An absent sibling is the normal case for a file whose pages live in the install;
                    // the game lookup answers for it, and an unresolved page fails loudly in decode.
                    return undefined;
                }
            }),
        );
        const siblings = new Map(found.filter((entry) => entry !== undefined));
        return decodeBamV2(
            structure,
            composePvrzResolver({
                readSibling: (resource) => siblings.get(resource),
                // The archive lookup is keyed by resref and extension, so the resource name splits
                // here rather than the resolver's one-name contract bending to fit it.
                ...(resourceBytes
                    ? {
                          readGameResource: (resource: string): Uint8Array | undefined =>
                              resourceBytes(uri, path.parse(resource).name, "pvrz"),
                      }
                    : {}),
            }),
            // The file's own bytes travel with the animation so an untouched v2 saves back exactly as
            // it was read, rather than through a re-encode that block compression would degrade.
            bytes,
        );
    }

    // Probe the opened .bam's siblings for the other pair member: first as the base (companion =
    // stem + "e"/"E"), then as the companion (base = stem minus its trailing "e"). combineIeBamPair
    // does the actual shape validation, so an unrelated same-named sibling never pairs.
    //
    // Siblings are derived from the opened URI rather than a filesystem path, so the probe stays in
    // whatever served it: a game resource looks for its companion in the same game, where the pair
    // actually lives, instead of at the root of the local filesystem.
    private static async tryReadIePair(
        uri: vscode.Uri,
        bytes: Uint8Array,
    ): Promise<{ animation: IndexedAnimation; info: IePairInfo } | undefined> {
        const opened = ImageEditorDocument.tryParseBam(bytes, uri);
        if (!opened) return undefined;

        const candidates = eastCompanionCandidates(uri.path).map((p) => uri.with({ path: p }));
        const eastReads = await Promise.all(candidates.map((c) => ImageEditorDocument.tryReadUri(c)));
        const hit = eastReads.findIndex((b) => b !== undefined);
        const eastUri = candidates[hit];
        const eastBytes = eastReads[hit];
        if (eastUri !== undefined && eastBytes !== undefined) {
            const east = ImageEditorDocument.tryParseBam(eastBytes, eastUri);
            const combined = east && combineIeBamPair(opened.animation, east.animation);
            if (east && combined) {
                return {
                    animation: combined,
                    info: { baseUri: uri, eastUri, baseFormat: opened.format, eastFormat: east.format },
                };
            }
        }

        const basePath = baseCandidatePath(uri.path);
        if (basePath !== undefined) {
            const baseUri = uri.with({ path: basePath });
            const baseBytes = await ImageEditorDocument.tryReadUri(baseUri);
            const base = baseBytes && ImageEditorDocument.tryParseBam(baseBytes, baseUri);
            const combined = base && combineIeBamPair(base.animation, opened.animation);
            if (base && combined) {
                return {
                    animation: combined,
                    info: { baseUri, eastUri: uri, baseFormat: base.format, eastFormat: opened.format },
                };
            }
        }
        return undefined;
    }

    private static tryParseBam(
        bytes: Uint8Array,
        uri: vscode.Uri,
    ): { animation: IndexedAnimation; format: BamFormat } | undefined {
        try {
            const animation = loadImage(bytes, path.posix.basename(uri.path));
            const format = animation.meta.sourceFormat;
            // A .bam-named file whose bytes are something else never joins a pair.
            if (format !== "bam" && format !== "bamc") return undefined;
            return { animation, format };
        } catch {
            // A sibling that will not decode is not a pair, which is the same answer as one that is the
            // wrong format - the caller opens the file on its own.
            return undefined;
        }
    }

    // Read the six `.fr0`-`.fr5` siblings (missing ones become undefined -> an empty facing) and
    // merge them into one 6-direction FRM. The sidecar palette is the combined file's `<base>.pal`.
    private static async readFrSplit(
        fsPath: string,
    ): Promise<{ animation: IndexedAnimation; sidecarBytes: Uint8Array | undefined }> {
        const files = await Promise.all(frSplitSiblingPaths(fsPath).map((p) => ImageEditorDocument.tryReadFile(p)));
        const animation = combineFrmDirections(files);
        const sidecarBytes = await ImageEditorDocument.tryReadFile(sidecarPalPath(frSplitCombinedPath(fsPath)));
        return { animation, sidecarBytes };
    }

    private static async tryReadFile(fsPath: string): Promise<Uint8Array | undefined> {
        return ImageEditorDocument.tryReadUri(vscode.Uri.file(fsPath));
    }

    private static async tryReadUri(uri: vscode.Uri): Promise<Uint8Array | undefined> {
        try {
            return await vscode.workspace.fs.readFile(uri);
        } catch {
            // Probing for an optional companion file: an absent one is the ordinary case, and its callers
            // read undefined as "no such sibling" rather than as a failure.
            return undefined;
        }
    }

    // FRM carries no embedded palette and may have a sidecar .pal; BAM/BAMC always embed their
    // own, so probing for one there would only spend a read on a file that is never consulted.
    private static async readSidecar(uri: vscode.Uri): Promise<Uint8Array | undefined> {
        if (!uri.fsPath.toLowerCase().endsWith(".frm")) return undefined;
        try {
            return await vscode.workspace.fs.readFile(vscode.Uri.file(sidecarPalPath(uri.fsPath)));
        } catch {
            // The sidecar palette is optional; most FRMs ship without one, so its absence is not a failure.
            return undefined;
        }
    }

    private fireEdit(label: string): void {
        // The model is captured now, not read at undo time: a set document swaps models when the reader
        // picks another action, and an undo that read `this.model` would then unwind the wrong picture.
        const edited = this.model;
        this._onDidChangeCustomDocument.fire({
            document: this,
            label,
            undo: () => edited.undo(),
            redo: () => edited.redo(),
        });
    }

    applyMetaPatch(patch: MetaPatch): void {
        // Only an edit the format can actually store becomes a document edit. Retuning a BAM's
        // playback rate changes what the editor shows and nothing the save writes, so marking the
        // file dirty for it would promise a persistence no reopen delivers (see persistedMetaFields).
        if (this.model.applyMetaPatch(patch)) this.fireEdit("Edit animation properties");
    }

    setExternalPalette(enabled: boolean): void {
        this.model.setExternalPalette(enabled);
        this.fireEdit(enabled ? "Enable external palette" : "Disable external palette");
    }

    replaceSequences(next: Animation, mode: "replace" | "append"): void {
        this.model.replaceSequences(next, mode);
        this.fireEdit(mode === "append" ? "Import cycles" : "Replace cycles");
    }

    /**
     * Apply an imported set folder across several members at once.
     *
     * ONE undo step for the whole import, not one per member: the reader performed a single action, and a
     * stack that made them press undo a dozen times to get back would leave the set half-imported at every
     * step in between. Each member's own model still does its own undo - they are just unwound together.
     */
    replaceSetSequences(
        parts: readonly { model: ImageDocumentModel; animation: Animation }[],
        mode: "replace" | "append",
    ): void {
        for (const part of parts) part.model.replaceSequences(part.animation, mode);
        const models = parts.map((part) => part.model);
        this._onDidChangeCustomDocument.fire({
            document: this,
            label: mode === "append" ? "Import set cycles" : "Replace set cycles",
            undo: () => {
                for (const model of models) model.undo();
            },
            redo: () => {
                for (const model of models) model.redo();
            },
        });
    }

    toView(options?: { include?: ReadonlySet<number> }): AnimationView {
        // dirName lives here, not in the model: the model is deliberately path-free, and the
        // document owns the file identity (see saveUri). Only FRM naming reads it, and an FRM is
        // always a real file, so the filesystem path is the right form to take the folder from.
        return {
            ...this.model.toView(options),
            dirName: path.basename(path.dirname(this.saveUri.fsPath)),
            composedFiles: this.composedFiles(),
            // The game directory travels with the set view because one of the destinations it offers is the
            // install's own override folder, and naming that folder is the point of offering it.
            ...(this.setState === undefined
                ? {}
                : { set: setView(this.setState, parseAnimationSetUri(this.uri)?.gameDir ?? "") }),
        };
    }

    /**
     * How many files the open picture was combined from - see the field's note in `messages.ts`.
     *
     * The set's answer comes first and is the OPEN MEMBER's, not the set's file count: a set is many
     * files by definition, and what the header is saying is how the one picture on the stage was put
     * together. The two document-level compositions below cannot both apply, so their order is arbitrary.
     */
    private composedFiles(): number {
        const state = this.setState;
        if (state !== undefined) return state.action.parts.length;
        if (this.isFrSplit) return FR_SPLIT_MEMBERS;
        return this.iePair === undefined ? 1 : 2;
    }

    /**
     * Show another stance of the open set. Refused for a file document, and for a stance the set does not
     * draw - the caller reposts the view either way, so a refused pick snaps the control back to what is
     * actually open rather than leaving it showing a choice that did not take.
     */
    selectSetStance(key: string): SetPick {
        const state = this.setState;
        if (state === undefined) return "refused";
        const pick = state.select(key);
        // Two stances of one packed file share a model, so this is often the model already open -
        // `useModel` returns on that, which is what keeps a move between bands off the reader's edits.
        if (pick === "changed") this.useModel(state.model);
        return pick;
    }

    /** Show another armour level of the open set, on its first stance that draws. Refused as above. */
    selectSetArmour(level: number): SetPick {
        const state = this.setState;
        if (state === undefined) return "refused";
        const pick = state.selectArmour(level);
        if (pick === "changed") this.useModel(state.model);
        return pick;
    }

    getBytes(): Uint8Array {
        return this.model.getBytes();
    }

    /** See ImageDocumentModel.indexedForExport - the document as indexed, and what that cost. */
    indexedForExport(opts: { target: IndexedSourceFormat; palette?: Rgba[] }): {
        animation: IndexedAnimation;
        report: LossReport;
    } {
        return this.model.indexedForExport(opts);
    }

    /** See ImageDocumentModel.saveArtifacts - the artifact bytes plus any PVRZ pages to write. */
    saveArtifacts(options: { standalone?: boolean } = {}): { bytes: Uint8Array; pages: readonly BamV2PageWrite[] } {
        return this.model.saveArtifacts(options);
    }

    /** See ImageDocumentModel.needsFreshPages - whether a save must allocate PVRZ pages. */
    needsFreshPages(): boolean {
        return this.model.needsFreshPages();
    }

    /** See ImageDocumentModel.chosenBasePage / setBasePage - the page number a repack starts at. */
    chosenBasePage(): number | undefined {
        return this.model.chosenBasePage();
    }

    setBasePage(page: number): void {
        this.model.setBasePage(page);
    }

    backup(): DocumentBackup {
        const state = this.setState;
        if (state === undefined) return this.model.backup();
        // A set has no artifact of its own, so the main payload is empty and every changed member travels
        // in the member table - the open one included, since it is a member like any other.
        return {
            bytes: new Uint8Array(),
            externalPalette: false,
            members: state.editedMembers().map(({ action, model }) => {
                const member = model.backup();
                return { resref: action.resref, bytes: member.bytes, externalPalette: member.externalPalette };
            }),
        };
    }

    sidecarBytes(): Uint8Array | undefined {
        return this.model.sidecarBytes();
    }

    get animation(): Animation {
        return this.model.animation;
    }

    /**
     * IndexedAnimation with the active palette resolved in - use for exports/conversions (see
     * model). Undefined for a true-colour document, which has no palette to resolve.
     */
    resolvedAnimation(): IndexedAnimation | undefined {
        return this.model.resolvedAnimation();
    }

    async reload(): Promise<void> {
        if (this.setState !== undefined) {
            // Re-read from the game rather than from `this.uri`: a set address has no bytes of its own, and
            // the FS provider refuses a read of one for exactly that reason.
            this.setState.reload();
            this.useModel(this.setState.model);
            return;
        }
        if (this.isFrSplit) {
            const { animation, sidecarBytes } = await ImageEditorDocument.readFrSplit(this.uri.fsPath);
            this.model.reloadAnimation(animation, sidecarBytes);
            return;
        }
        const bytes = await vscode.workspace.fs.readFile(this.uri);
        if (this.iePair) {
            // Re-pair from disk; if the companion vanished, fall back to the opened file alone (the
            // document keeps its pair identity - the next save recreates the companion).
            const pair = await ImageEditorDocument.tryReadIePair(this.uri, bytes);
            if (pair) {
                this.model.reloadAnimation(pair.animation);
                return;
            }
        }
        const sidecarBytes = await ImageEditorDocument.readSidecar(this.uri);
        this.model.reload(bytes, sidecarBytes);
    }

    dispose(): void {
        this._onDidChangeCustomDocument.dispose();
        this._onDidRefresh.dispose();
    }
}
