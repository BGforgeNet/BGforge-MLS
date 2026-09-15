/**
 * Writing a whole animation set out in one Save As.
 *
 * A set is a dozen to eighty files, so a save that wrote only the stance on screen produced a folder
 * that looked like an export and held one member of a creature. Everything here is per MEMBER, named
 * for the file it came from, so the folder that comes out is the set.
 *
 * Pure of `vscode`, like `conversion.ts` beside it: the destination prompt, the consent modals and the
 * writes live in `save-flow.ts`, and the planning below is testable without a host.
 *
 * FRM is deliberately not a target here. A set has no single FRM, and turning one into a folder of
 * Fallout critter files needs a naming family, a stem and an animation id - which is what the conversion
 * mode already asks for, and what `conversion.ts` already writes.
 */
import * as path from "path";
import {
    type Animation,
    type IndexedAnimation,
    type Rgba,
    LossReport,
    convertToBamV2,
    importPngDirectory,
    isRgbaAnimation,
    serializeBamV2,
    splitIeBamBlocks,
} from "@bgforge/image";
import { type SetManifestSource, readSetManifest, writeSetManifest } from "@bgforge/animation";
import { buildCrossFormatSave, buildExport } from "./export-actions";
import { type SaveWrite, pvrzPageWrites } from "./save";
import { saveAsTargetPath } from "./save-as";
import type { ImageDocumentModel } from "./document-model";
import type { SaveAsTarget } from "./webview/messages";

/** One file of the set, as an export writes it. */
export interface SetExportMember {
    resref: string;
    armour: number;
    model: ImageDocumentModel;
    /**
     * The eastern twin this member was composed with, where it has one - the file the western half's
     * declaration sends the engine to for the eastern facings.
     */
    east?: string;
}

/** The Save As targets a whole set can be written into directly - see the note on FRM above. */
export type SetExportTarget = Exclude<SaveAsTarget, "frm">;

export interface SetExportPlan {
    writes: SaveWrite[];
    /** Every member's losses folded into one, deduplicated: the reader decides about the set, once. */
    report: LossReport;
    /** PVRZ pages allocated across the whole set, for the status line. */
    pageCount: number;
}

export interface SetExportInput {
    members: readonly SetExportMember[];
    target: SetExportTarget;
    destDir: string;
    /** What the set manifest records about where this came from. Unread by the importer. */
    source: SetManifestSource;
    /** A chosen creature's colours, baked into every member rather than into the open one alone. */
    palette?: Rgba[];
    /** The first PVRZ page number a BAM v2 export may allocate. */
    basePage?: number;
}

/**
 * The container or image export a request names, for the path that writes a set AS IT STANDS.
 *
 * The direction and naming controls say nothing here: they matched the source, which is what put the save
 * on this path rather than through a conversion. What is left is the container the members are packed in.
 */
export function saveTargetOf(request: {
    format: "bam" | "frm" | "apng" | "png-directory";
    bamVersion: 1 | 2;
    compressed: boolean;
}): SetExportTarget {
    if (request.format === "apng" || request.format === "png-directory") return request.format;
    // An FRM never reaches here - writing a set as Fallout files is a retarget by definition, since no
    // Infinity Engine set is already stored that way.
    if (request.bamVersion === 2) return "bamv2";
    return request.compressed ? "bamc" : "bam";
}

/** The file (or folder) one member lands on, through the same naming table a single-file Save As uses. */
export function setMemberPath(destDir: string, resref: string, target: SetExportTarget): string {
    return saveAsTargetPath(path.join(destDir, resref), target);
}

/**
 * Whether this export has to ask for a first PVRZ page number.
 *
 * Answered off the members' own colour model rather than by converting them: an indexed member has no
 * data blocks to carry over, so writing it as BAM v2 packs fresh pages by definition, and converting the
 * whole set twice to learn that is the same work done for an answer already on hand.
 */
export function setExportNeedsBasePage(members: readonly SetExportMember[], target: SetExportTarget): boolean {
    if (target !== "bamv2") return false;
    return members.some((member) => !isRgbaAnimation(member.model.animation) || member.model.needsFreshPages());
}

/** The animation to write for one member, with a chosen creature's colours in it where there are any. */
function memberAnimation(member: SetExportMember, palette: Rgba[] | undefined): Animation {
    // resolvedAnimation, not animation: an FRM's own palette is an all-black placeholder, and exporting
    // the raw one writes black silhouettes (see document-model).
    const base = member.model.resolvedAnimation() ?? member.model.animation;
    if (palette === undefined || isRgbaAnimation(base)) return base;
    return { ...base, palette };
}

/** As above, quantized for a palette-indexed target, with what that cost. */
function memberIndexed(
    member: SetExportMember,
    target: "bam" | "bamc",
    palette: Rgba[] | undefined,
): { animation: IndexedAnimation; report: LossReport } {
    const { animation, report } = member.model.indexedForExport({ target });
    return { animation: palette === undefined ? animation : { ...animation, palette }, report };
}

/**
 * The container writes for one member: its own file, or a base and its eastern twin where the member was
 * composed from a pair.
 *
 * A pair goes back over BOTH files, the way a plain save of one already does. The engine forms the twin's
 * name from the declaration and never looks to see whether the base holds the eastern facings, so one
 * combined file leaves the install's OLD twin drawing the eastern half beside freshly written west - the
 * same half-written animation whichever way the reader saved, with nothing on screen saying so.
 *
 * A pair whose cycles no longer sit on the 8-slot blocks cannot be cut back apart; it goes out as the one
 * file it is, which is the only thing left that keeps all of its art.
 */
function ieContainerWrites(
    animation: IndexedAnimation,
    member: SetExportMember,
    target: "bam" | "bamc",
    destDir: string,
    targetPath: string,
): { writes: SaveWrite[]; report: LossReport }[] {
    const split = member.east === undefined ? undefined : splitIeBamBlocks(animation);
    if (split === undefined || member.east === undefined) {
        return [buildCrossFormatSave(animation, target, targetPath)];
    }
    return [
        buildCrossFormatSave(split.base, target, targetPath),
        buildCrossFormatSave(split.east, target, setMemberPath(destDir, member.east, target)),
    ];
}

/**
 * The files one member is written as, named. The preview a reader decides on reads this rather than
 * counting members: only an Infinity Engine container puts a pair back over two files, and a preview
 * restating that rule for itself is the copy that drifts from what the writer does.
 */
export function setMemberResrefs(member: { resref: string; east?: string }, target: SetExportTarget): string[] {
    if (member.east === undefined || (target !== "bam" && target !== "bamc")) return [member.resref];
    return [member.resref, member.east];
}

/**
 * One member as BAM v2, plus the pages it allocated.
 *
 * `basePage` advances across the set: page numbers name a `MOS<nnnn>.PVRZ` beside the `.bam`, so two
 * members allocating from the same base would write the same filenames and the second would silently
 * replace the first's frames.
 */
function bamV2Member(
    member: SetExportMember,
    targetPath: string,
    palette: Rgba[] | undefined,
    basePage: number | undefined,
): { writes: SaveWrite[]; report: LossReport; nextPage: number | undefined } {
    const { animation, report } = convertToBamV2(memberAnimation(member, palette));
    const saved = serializeBamV2(animation, basePage === undefined ? { emitUnchangedPages: true } : { basePage });
    const pages = pvrzPageWrites(targetPath, saved.pages);
    const highest = saved.pages.reduce((max, page) => Math.max(max, page.page), -1);
    return {
        writes: [{ path: targetPath, bytes: saved.bam }, ...pages],
        report,
        // Only an allocating run advances the base; an unchanged-pages run kept the numbers it was read
        // with, which say nothing about what is free.
        nextPage: basePage === undefined ? undefined : Math.max(basePage, highest + 1),
    };
}

/** Fold every member's report into one, dropping the repeats a per-member walk necessarily produces. */
function foldReports(reports: readonly LossReport[]): LossReport {
    const folded = new LossReport();
    const seen = new Set<string>();
    for (const report of reports) {
        for (const item of report.items) {
            const key = `${item.kind} ${item.detail}`;
            if (seen.has(key)) continue;
            seen.add(key);
            folded.add(item.kind, item.detail);
        }
    }
    return folded;
}

/**
 * What a set export would cost, without building it.
 *
 * The dialog asks for a plan on every control it has, and building the bytes of a hundred-member character
 * set per change is not a preview of the save, it IS the save. So this reads the cost off the members'
 * colour model and the chosen palette instead: an already-indexed member written to an indexed container
 * loses nothing, a true-colour one is quantized, and a chosen creature's colours are baked in either way.
 *
 * A second statement of what `buildSetExport` reports, deliberately, and `set-export.test.ts` pins the two
 * against each other over a member of each colour model so they cannot drift apart in silence.
 */
export function setExportLosses(
    members: readonly SetExportMember[],
    target: SetExportTarget,
    palette: Rgba[] | undefined,
): LossReport {
    const report = new LossReport();
    const indexedTarget = target === "bam" || target === "bamc";
    if (indexedTarget) {
        for (const member of members) {
            if (member.model.resolvedAnimation() !== undefined) continue;
            const { report: cost } = member.model.indexedForExport({ target, ...(palette ? { palette } : {}) });
            for (const item of cost.items) report.add(item.kind, item.detail);
        }
    }
    if (palette !== undefined) report.add("creature-colours-baked", CREATURE_COLOURS_NOTE);
    return report;
}

export function buildSetExport(input: SetExportInput): SetExportPlan {
    const { members, target, destDir, palette } = input;
    if (input.basePage === undefined && setExportNeedsBasePage(members, target)) {
        throw new Error("buildSetExport: a BAM v2 export of these members must be given a first page number");
    }

    const writes: SaveWrite[] = [];
    const reports: LossReport[] = [];
    let pageCount = 0;
    let nextPage = input.basePage;

    for (const member of members) {
        const targetPath = setMemberPath(destDir, member.resref, target);
        if (target === "bamv2") {
            const built = bamV2Member(member, targetPath, palette, nextPage);
            writes.push(...built.writes);
            reports.push(built.report);
            pageCount += built.writes.length - 1;
            nextPage = built.nextPage;
        } else if (target === "apng" || target === "png-directory") {
            // Both PNG targets hold everything either colour model does, so the animation goes out as it
            // is - no quantization, and nothing to report beyond a baked-in creature palette.
            writes.push(...buildExport(memberAnimation(member, palette), target, targetPath));
        } else {
            const { animation, report } = memberIndexed(member, target, palette);
            reports.push(report);
            for (const built of ieContainerWrites(animation, member, target, destDir, targetPath)) {
                writes.push(...built.writes);
                reports.push(built.report);
            }
        }
    }

    // The manifest is what makes a directory export re-importable as a SET: without it the folders are
    // just animations that happen to sit side by side, and nothing says which file each belongs to.
    if (target === "png-directory") {
        const manifest = writeSetManifest({
            source: input.source,
            members: members.map((member) => ({
                resref: member.resref,
                armour: member.armour,
                directory: path.basename(setMemberPath(destDir, member.resref, target)),
            })),
        });
        writes.unshift({
            path: path.join(destDir, SET_MANIFEST_NAME),
            bytes: new TextEncoder().encode(JSON.stringify(manifest, undefined, 2)),
        });
    }

    const report = foldReports(reports);
    if (palette !== undefined) report.add("creature-colours-baked", CREATURE_COLOURS_NOTE);
    return { writes, report, pageCount };
}

/** The set manifest's name inside an exported folder - what an import looks for to recognise one. */
export const SET_MANIFEST_NAME = "set.json";

/** One member of an exported set folder, read back. */
export interface SetDirectoryMember {
    resref: string;
    armour: number;
    animation: Animation;
}

export interface SetDirectoryImport {
    source: SetManifestSource;
    members: SetDirectoryMember[];
}

/**
 * Whether this folder is an exported SET rather than a single animation.
 *
 * The two are told apart by the manifest at the top, which is also the only thing distinguishing them:
 * an exported set's member folders are ordinary animation directories, so a reader who points the
 * single-file import at one of them gets exactly that member and nothing is ambiguous.
 */
export function isSetDirectory(files: ReadonlyMap<string, Uint8Array>): boolean {
    return files.has(SET_MANIFEST_NAME);
}

/**
 * Read an exported set folder back, member by member.
 *
 * The inverse of the `png-directory` arm of `buildSetExport`, and kept beside it because the two are the
 * two halves of one on-disk shape. A member the manifest names but the folder does not hold throws:
 * importing a half-deleted export as a smaller set would silently leave the missing members at whatever
 * the document already had, which reads as a successful import of the whole thing.
 */
export function readSetDirectory(files: ReadonlyMap<string, Uint8Array>): SetDirectoryImport {
    const manifestBytes = files.get(SET_MANIFEST_NAME);
    if (manifestBytes === undefined) {
        throw new Error(`readSetDirectory: no ${SET_MANIFEST_NAME} - this folder is not an exported animation set`);
    }
    const manifest = readSetManifest(JSON.parse(new TextDecoder().decode(manifestBytes)));
    const members = manifest.members.map((member) => {
        const prefix = `${member.directory}/`;
        const own = new Map<string, Uint8Array>();
        for (const [name, bytes] of files) {
            if (name.startsWith(prefix)) own.set(name.slice(prefix.length), bytes);
        }
        if (!own.has("manifest.json")) {
            throw new Error(
                `readSetDirectory: ${member.resref} names the folder "${member.directory}", which is absent`,
            );
        }
        return { resref: member.resref, armour: member.armour, animation: importPngDirectory(own) };
    });
    return { source: manifest.source, members };
}

/** An imported directory paired with the open set's member it replaces. */
export interface SetImportMatch {
    matched: { member: SetExportMember; animation: Animation }[];
    /** Members of the open set the imported folder does not name. */
    missing: string[];
    /** Directories in the folder naming a file this set does not draw. */
    unknown: string[];
}

/**
 * Line an imported set folder up against the open set, member by member.
 *
 * Both mismatched directions are reported rather than silently intersected: a folder exported from a
 * different creature shares some of its resrefs with nothing, and applying only the two that happen to
 * match reads as a whole-set import while leaving most of the set at whatever was there before.
 *
 * Matched case-insensitively - resrefs are upper case in the archive, and a folder on disk can be
 * renamed to anything the filesystem accepts.
 */
export function matchSetImport(
    imported: readonly SetDirectoryMember[],
    members: readonly SetExportMember[],
): SetImportMatch {
    const byResref = new Map(members.map((member) => [member.resref.toUpperCase(), member]));
    const matched: SetImportMatch["matched"] = [];
    const unknown: string[] = [];
    const taken = new Set<string>();
    for (const entry of imported) {
        const key = entry.resref.toUpperCase();
        const member = byResref.get(key);
        if (member === undefined) unknown.push(entry.resref);
        else {
            matched.push({ member, animation: entry.animation });
            taken.add(key);
        }
    }
    const missing = members.filter((member) => !taken.has(member.resref.toUpperCase())).map((m) => m.resref);
    return { matched, missing, unknown };
}

/** Stated once for the whole set rather than per member, which is how the reader decides about it. */
const CREATURE_COLOURS_NOTE =
    "written in the chosen creature's colours - the result cannot be recoloured as another creature";
