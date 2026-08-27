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
    serializeBamV1,
    splitIeBamPair,
} from "@bgforge/image";
import type { DocumentBackup } from "./backup";
import { ImageDocumentModel } from "./document-model";
import { frSplitCombinedPath, frSplitSiblingPaths, isFrSplitPath } from "./fr-split";
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

/** One write of an in-place pair save, addressed by URI so it lands back where the member was read. */
export interface PairWrite {
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
    // load and saved back to a single `<base>.frm` (see fr-split.ts and the provider's save path).
    readonly isFrSplit: boolean;
    // Set when the document was opened from an IE base/east BAM pair (see ie-pair.ts): the pair is
    // combined on load into one full-rose animation and split back into both files on save.
    readonly iePair: IePairInfo | undefined;
    private readonly model: ImageDocumentModel;

    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<
        vscode.CustomDocumentEditEvent<ImageEditorDocument>
    >();
    readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

    private readonly _onDidRefresh = new vscode.EventEmitter<void>();
    readonly onDidRefresh = this._onDidRefresh.event;

    private constructor(uri: vscode.Uri, model: ImageDocumentModel, isFrSplit: boolean, iePair?: IePairInfo) {
        this.uri = uri;
        this.isFrSplit = isFrSplit;
        this.iePair = iePair;
        this.model = model;
        this.model.onChange = () => this._onDidRefresh.fire();
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
    ): Promise<ImageEditorDocument> {
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
     * What an in-place save writes to: the combined `<base>.frm` for a split set, the base member for
     * an IE pair (the provider splits a pair save across both members), else the source. A split-set
     * save deliberately overwrites any pre-existing `<base>.frm` without prompting - the split members
     * are the source of truth for that basename.
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
    pairSaveWrites(): PairWrite[] | undefined {
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
            return undefined;
        }
    }

    private fireEdit(label: string): void {
        this._onDidChangeCustomDocument.fire({
            document: this,
            label,
            undo: () => this.model.undo(),
            redo: () => this.model.redo(),
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

    toView(): AnimationView {
        // dirName lives here, not in the model: the model is deliberately path-free, and the
        // document owns the file identity (see saveUri). Only FRM naming reads it, and an FRM is
        // always a real file, so the filesystem path is the right form to take the folder from.
        return { ...this.model.toView(), dirName: path.basename(path.dirname(this.saveUri.fsPath)) };
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
        return this.model.backup();
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
