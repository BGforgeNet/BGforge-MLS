import { describe, expect, it } from "vitest";
import {
    DEFAULT_FALLOUT_PALETTE,
    type Frame,
    type IndexedAnimation,
    importPngDirectory,
    isBamc,
    isRgbaAnimation,
    loadImage,
    serializeBamV1,
} from "@bgforge/image";
import { readSetManifest } from "@bgforge/animation";
import { ImageDocumentModel } from "../../src/image-editor/document-model";
import {
    buildSetExport,
    isSetDirectory,
    matchSetImport,
    readSetDirectory,
    setExportLosses,
    setExportNeedsBasePage,
    type SetExportMember,
} from "../../src/image-editor/set-export";

/** One 2x1 frame whose pixels identify the member it belongs to. */
function bamOf(seed: number): Uint8Array {
    const frames: Frame[] = [
        { width: 2, height: 1, pixels: Uint8Array.from([seed, seed + 1]), offsetX: 0, offsetY: 0 },
    ];
    const animation: IndexedAnimation = {
        palette: DEFAULT_FALLOUT_PALETTE.map((c) => ({ ...c })),
        frames,
        sequences: [{ frameRefs: [0], facing: "none" }],
        meta: { sourceFormat: "bam", transparentIndex: 0 },
    };
    return serializeBamV1(animation);
}

function members(): SetExportMember[] {
    return [
        { resref: "TSTBG1", armour: 1, model: ImageDocumentModel.fromBytes(bamOf(10), "TSTBG1.bam") },
        { resref: "TSTCG1", armour: 2, model: ImageDocumentModel.fromBytes(bamOf(20), "TSTCG1.bam") },
    ];
}

/**
 * A member the editor composed from a base file and its eastern twin: one eight-slot direction block, a
 * frame in every slot. Built through the real serializer so the export reads it the way it reads an
 * install's own file.
 */
function pairMember(): SetExportMember {
    const frames: Frame[] = Array.from({ length: 8 }, (_, slot) => ({
        width: 2,
        height: 1,
        pixels: Uint8Array.from([slot, slot + 1]),
        offsetX: 0,
        offsetY: 0,
    }));
    const animation: IndexedAnimation = {
        palette: DEFAULT_FALLOUT_PALETTE.map((c) => ({ ...c })),
        frames,
        sequences: frames.map((_, slot) => ({ frameRefs: [slot], facing: "none" })),
        meta: { sourceFormat: "bam", transparentIndex: 0 },
    };
    return {
        resref: "TSTBG1",
        armour: 1,
        east: "TSTBG1E",
        model: ImageDocumentModel.fromBytes(serializeBamV1(animation), "TSTBG1.bam"),
    };
}

const SOURCE = { id: 0x1234, title: "Test creature", flavour: "bg2ee" };

function planOf(target: Parameters<typeof buildSetExport>[0]["target"], extra = {}) {
    return buildSetExport({ members: members(), target, destDir: "/out", source: SOURCE, ...extra });
}

/** The bytes written at one path, so a test can decode what actually landed rather than count files. */
function bytesAt(writes: { path: string; bytes: Uint8Array }[], path: string): Uint8Array {
    const found = writes.find((write) => write.path === path);
    if (found === undefined) throw new Error(`no write at ${path}, only: ${writes.map((w) => w.path).join(", ")}`);
    return found.bytes;
}

describe("buildSetExport", () => {
    it("writes one file per member, named for the file it came from", () => {
        const { writes } = planOf("bam");

        expect(writes.map((write) => write.path)).toEqual(["/out/TSTBG1.bam", "/out/TSTCG1.bam"]);
    });

    /**
     * The DECODED frames, not the file count: a set export that wrote every member from the open stance's
     * model would produce exactly the right number of correctly named files with identical contents.
     */
    it("writes each member's own pixels rather than the open one's", () => {
        const { writes } = planOf("bam");

        const first = loadImage(bytesAt(writes, "/out/TSTBG1.bam"), "TSTBG1.bam");
        const second = loadImage(bytesAt(writes, "/out/TSTCG1.bam"), "TSTCG1.bam");

        expect(first.frames[0]?.pixels).toEqual(Uint8Array.from([10, 11]));
        expect(second.frames[0]?.pixels).toEqual(Uint8Array.from([20, 21]));
    });

    /**
     * A member composed from a base file and its eastern twin goes back over BOTH of them. The engine reads
     * the east from the twin whenever the declaration says the east is stored - it never looks to see
     * whether the base holds it - so one combined file leaves the install's old twin drawing the eastern
     * half beside freshly written west, and nothing anywhere says so.
     */
    it("writes a pair member back over its base and its eastern twin", () => {
        const { writes } = buildSetExport({
            members: [pairMember()],
            target: "bam",
            destDir: "/out",
            source: SOURCE,
        });

        expect(writes.map((write) => write.path)).toEqual(["/out/TSTBG1.bam", "/out/TSTBG1E.bam"]);
    });

    /** The split is by SLOT: the western arc lands in the base, the eastern in the twin. */
    it("puts the western facings in the base and the eastern ones in the twin", () => {
        const { writes } = buildSetExport({
            members: [pairMember()],
            target: "bam",
            destDir: "/out",
            source: SOURCE,
        });
        const base = loadImage(bytesAt(writes, "/out/TSTBG1.bam"), "TSTBG1.bam");
        const east = loadImage(bytesAt(writes, "/out/TSTBG1E.bam"), "TSTBG1E.bam");

        // Slot 0 is the south, which the base keeps; slot 5 is an eastern one, which only the twin holds.
        expect(base.sequences[0]?.frameRefs.length).toBe(1);
        expect(base.sequences[5]?.frameRefs.length).toBe(0);
        expect(east.sequences[0]?.frameRefs.length).toBe(0);
        expect(east.sequences[5]?.frameRefs.length).toBe(1);
    });

    it("writes a compressed container for the BAMC target", () => {
        const { writes } = planOf("bamc");

        expect(writes.map((write) => write.path)).toEqual(["/out/TSTBG1.bam", "/out/TSTCG1.bam"]);
        expect(isBamc(bytesAt(writes, "/out/TSTBG1.bam"))).toBe(true);
    });

    /**
     * One ordinary animation directory per member plus a set manifest above them, so both readers stay
     * unchanged: the per-animation one never learns about sets, and the set one never learns about frames.
     */
    it("writes a PNG directory per member under a set manifest naming them", () => {
        const { writes } = planOf("png-directory");

        const manifest = readSetManifest(JSON.parse(new TextDecoder().decode(bytesAt(writes, "/out/set.json"))));
        expect(manifest.source).toEqual(SOURCE);
        expect(manifest.members).toEqual([
            { resref: "TSTBG1", armour: 1, directory: "TSTBG1" },
            { resref: "TSTCG1", armour: 2, directory: "TSTCG1" },
        ]);
    });

    it("writes each member's PNG directory so it reads back as that member's frames", () => {
        const { writes } = planOf("png-directory");

        const files = new Map<string, Uint8Array>();
        for (const write of writes) {
            if (write.path.startsWith("/out/TSTCG1/")) files.set(write.path.slice("/out/TSTCG1/".length), write.bytes);
        }
        const animation = importPngDirectory(files);

        expect(isRgbaAnimation(animation)).toBe(false);
        expect(animation.frames[0]?.pixels).toEqual(Uint8Array.from([20, 21]));
    });

    /** The suffix is what keeps the two directory targets from landing on one folder per member. */
    it("keeps the APNG export in its own per-member folder", () => {
        const { writes } = planOf("apng");

        expect(writes.every((write) => /^\/out\/TST[BC]G1-apng\//.test(write.path))).toBe(true);
    });

    it("writes no set manifest for a target that is one file per member", () => {
        expect(planOf("bam").writes.some((write) => write.path === "/out/set.json")).toBe(false);
    });

    /**
     * Page numbers address a file beside the .bam, so two members allocating from the same base would
     * each write MOS0500.PVRZ and the second would silently replace the first's frames.
     */
    it("allocates PVRZ pages that no two members share", () => {
        const { writes } = planOf("bamv2", { basePage: 500 });

        const pages = writes.filter((write) => write.path.endsWith(".PVRZ")).map((write) => write.path);
        expect(pages.length).toBeGreaterThan(1);
        expect(new Set(pages).size).toBe(pages.length);
    });

    it("says a BAM v2 export of freshly packed members needs a base page", () => {
        expect(setExportNeedsBasePage(members(), "bamv2")).toBe(true);
        expect(setExportNeedsBasePage(members(), "bam")).toBe(false);
    });

    /** A chosen creature's colours are the whole set's, and the reader is warned about them once. */
    it("bakes a chosen palette into every member and reports it once", () => {
        const palette = DEFAULT_FALLOUT_PALETTE.map((c, i) => ({ ...c, r: (i * 7) % 256 }));
        const { writes, report } = planOf("bam", { palette });

        for (const path of ["/out/TSTBG1.bam", "/out/TSTCG1.bam"]) {
            const written = loadImage(bytesAt(writes, path), path);
            if (isRgbaAnimation(written)) throw new Error("expected an indexed animation");
            expect(written.palette[3]?.r).toBe(21);
        }
        expect(report.items.filter((item) => item.kind === "creature-colours-baked")).toHaveLength(1);
    });
});

/**
 * The dialog previews a save on every control it has, so it reads the cost off the members rather than
 * building the export to find out. That is a second statement of what a build reports, and these pin the
 * two together: they are only allowed to differ by nothing.
 */
describe("setExportLosses against a real build", () => {
    function kinds(report: { items: readonly { kind: string }[] }): string[] {
        return [...new Set(report.items.map((item) => item.kind))].sort();
    }

    it("reports what a build of the same members reports, for an indexed set", () => {
        const built = planOf("bam");

        expect(kinds(setExportLosses(members(), "bam", undefined))).toEqual(kinds(built.report));
    });

    it("reports what a build reports when a creature's colours are baked in", () => {
        const palette = DEFAULT_FALLOUT_PALETTE.map((c, i) => ({ ...c, r: (i * 7) % 256 }));
        const built = planOf("bam", { palette });

        expect(kinds(setExportLosses(members(), "bam", palette))).toEqual(kinds(built.report));
    });

    /** A PNG target holds either colour model, so a build of one reports no quantization and neither does this. */
    it("reports what a build reports for a target that loses nothing", () => {
        const built = planOf("png-directory");

        expect(kinds(setExportLosses(members(), "png-directory", undefined))).toEqual(kinds(built.report));
    });
});

/** The tree a folder of writes looks like once read back off disk, keyed the way readDirectoryTree keys it. */
function treeOf(writes: { path: string; bytes: Uint8Array }[], root = "/out"): Map<string, Uint8Array> {
    return new Map(writes.map((write) => [write.path.slice(`${root}/`.length), write.bytes]));
}

describe("readSetDirectory", () => {
    it("reads back every member a set export wrote, by the file it came from", () => {
        const exported = treeOf(planOf("png-directory").writes);

        const read = readSetDirectory(exported);

        expect(read.source).toEqual(SOURCE);
        expect(read.members.map((member) => [member.resref, member.armour])).toEqual([
            ["TSTBG1", 1],
            ["TSTCG1", 2],
        ]);
    });

    /** The round trip is the point: an export nobody can read back is a folder of pictures, not a set. */
    it("reads back each member's own frames", () => {
        const read = readSetDirectory(treeOf(planOf("png-directory").writes));

        expect(read.members[0]?.animation.frames[0]?.pixels).toEqual(Uint8Array.from([10, 11]));
        expect(read.members[1]?.animation.frames[0]?.pixels).toEqual(Uint8Array.from([20, 21]));
    });

    it("recognises a set export by its manifest, and a lone animation directory as not one", () => {
        expect(isSetDirectory(treeOf(planOf("png-directory").writes))).toBe(true);
        expect(isSetDirectory(treeOf(planOf("png-directory").writes.filter((w) => w.path !== "/out/set.json")))).toBe(
            false,
        );
    });

    /** Named, not skipped: a folder a reader has half-deleted must not import as a smaller set. */
    it("refuses a manifest naming a directory the folder does not hold", () => {
        const writes = planOf("png-directory").writes.filter((write) => !write.path.startsWith("/out/TSTCG1/"));

        expect(() => readSetDirectory(treeOf(writes))).toThrow(/TSTCG1/);
    });
});

describe("matchSetImport", () => {
    it("pairs each imported directory with the member of the open set it belongs to", () => {
        const open = members();
        const imported = readSetDirectory(treeOf(planOf("png-directory").writes));

        const match = matchSetImport(imported.members, open);

        expect(match.matched.map((entry) => entry.member.resref)).toEqual(["TSTBG1", "TSTCG1"]);
        expect(match.matched[0]?.animation.frames[0]?.pixels).toEqual(Uint8Array.from([10, 11]));
        expect(match.missing).toEqual([]);
        expect(match.unknown).toEqual([]);
    });

    /**
     * Both directions are reported rather than quietly intersected: a folder exported from another
     * creature would otherwise apply its two matching files and read as a whole-set import.
     */
    it("names the members neither side has in common", () => {
        const open = members();
        const imported = readSetDirectory(treeOf(planOf("png-directory").writes));
        imported.members[1] = { ...imported.members[1]!, resref: "OTHER" };

        const match = matchSetImport(imported.members, open);

        expect(match.matched.map((entry) => entry.member.resref)).toEqual(["TSTBG1"]);
        expect(match.missing).toEqual(["TSTCG1"]);
        expect(match.unknown).toEqual(["OTHER"]);
    });

    /** Resrefs are upper case in the archive and a folder can be renamed to anything a filesystem takes. */
    it("matches a member whose folder was renamed in another case", () => {
        const open = members();
        const imported = readSetDirectory(treeOf(planOf("png-directory").writes));
        imported.members[0] = { ...imported.members[0]!, resref: "tstbg1" };

        expect(matchSetImport(imported.members, open).matched.map((e) => e.member.resref)).toEqual([
            "TSTBG1",
            "TSTCG1",
        ]);
    });
});
