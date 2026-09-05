import { describe, expect, it } from "vitest";
import { openGame } from "@bgforge/binary";
import {
    type Animation,
    type IndexedAnimation,
    convertToRgba,
    decodeBamc,
    encodeBamc,
    isBamc,
    isRgbaAnimation,
    loadImage,
} from "@bgforge/image";
import { type AnimationSet, buildAnimationIndex } from "../src/animation-index";
import { tableForFlavour } from "../src/animation-tables";
import { type StanceIo } from "../src/set-stances";
import { type NeutralSet } from "../src/neutral/model";
import { readNeutralSet } from "../src/neutral/read";
import { writeNeutralSet } from "../src/neutral/write";
import { bandedPair, multiCycle } from "../../image/test/bam-fixtures.ts";

/** A character set at one armour level - the shape both character layouts resolve through. */
function characterSet(): AnimationSet {
    return {
        id: 0x6004,
        code: "CGMC",
        name: "CLERIC_MALE_GNOME",
        prefixByArmour: new Map([[1, "CDMB"]]),
        paperdollPrefix: undefined,
        scheme: { kind: "character" },
        section: "character",
    };
}

/** An archive of exactly the files named, serving the bytes given. */
function archiveOf(files: Record<string, Uint8Array>): StanceIo {
    return {
        exists: (resref) => resref in files,
        read: (resref) => files[resref],
    };
}

describe("reading a set into the neutral model", () => {
    it("carries the identity the index resolved, section included", () => {
        const neutral = readNeutralSet(characterSet(), archiveOf({ CDMB1G1: multiCycle(4, 8) }), {
            flavour: "tob",
        });

        expect(neutral.identity).toEqual({
            sourceId: 0x6004,
            code: "CGMC",
            name: "CLERIC_MALE_GNOME",
            sourceFlavour: "tob",
            sourceSection: "character",
        });
    });

    it("parses each file once, however many actions draw it", () => {
        // A base file plus its mirrored twin: one action, two files, and both must be carried or the
        // write-back would drop the eastern art the twin holds.
        const io = archiveOf({ CDMB1G1: bandedPair(4, [0, 1, 2, 3, 4]), CDMB1G1E: bandedPair(4, [5, 6, 7]) });
        const neutral = readNeutralSet(characterSet(), io, { flavour: "tob" });

        expect([...neutral.variants[0]!.files.keys()]).toEqual(["CDMB1G1", "CDMB1G1E"]);
    });

    /**
     * The whole point of the shape: a member references its file's frame pool rather than copying frames
     * into directions. Shipped files share frames across cycles heavily, so a model that copied them would
     * re-emit a much larger frame table - which no per-cycle pixel comparison would notice.
     */
    it("references the file's own sequences rather than copying frames out of them", () => {
        const io = archiveOf({ CDMB1G1: bandedPair(4, [0, 1, 2, 3, 4]) });
        const neutral = readNeutralSet(characterSet(), io, { flavour: "tob" });
        const variant = neutral.variants[0]!;
        const cycles = variant.actions[0]!.cycles;

        expect(cycles.kind).toBe("directional");
        const indices = cycles.kind === "directional" ? cycles.directions.map((d) => d.sequenceIndex) : [];
        // Every index addresses a real cycle of the parsed file, and the file keeps its whole table.
        const file = variant.files.get("CDMB1G1")!;
        expect(indices.length).toBeGreaterThan(0);
        for (const index of indices) expect(file.sequences[index]).toBeDefined();
        expect(file.sequences).toHaveLength(8);
    });

    it("records a base file's stored western arc and not the facings the engine mirrors", () => {
        const io = archiveOf({ CDMB1G1: bandedPair(4, [0, 1, 2, 3, 4]) });
        const cycles = readNeutralSet(characterSet(), io, { flavour: "tob" }).variants[0]!.actions[0]!.cycles;

        expect(cycles.kind === "directional" && cycles.directions.map((d) => d.facing)).toEqual([
            "S",
            "SW",
            "W",
            "NW",
            "N",
        ]);
    });

    /**
     * A reading the interpreter could only infer is not written down as a compass direction. Claiming one
     * is how a converter would come to fill a target's south slot from a cycle that is not south.
     */
    it("keeps an inferred reading as an ordered cycle list rather than asserting facings", () => {
        // Eight cycles of one distinct frame each: no base-file fingerprint, so the facings are a guess.
        const io = archiveOf({ CDMB1G1: multiCycle(4, 8) });
        const cycles = readNeutralSet(characterSet(), io, { flavour: "tob" }).variants[0]!.actions[0]!.cycles;

        expect(cycles.kind).toBe("ordered");
    });

    /**
     * Armour levels are separate members sharing a prefix, so each is its own variant with its own files -
     * not one variant whose files happen to differ. They are ordered lowest first regardless of the order
     * the index happened to record them, because a caller offering an armour picker reads them in order.
     */
    it("carries each armour level as its own variant, lowest first", () => {
        const set: AnimationSet = {
            ...characterSet(),
            prefixByArmour: new Map([
                [2, "CDMB"],
                [1, "CDMB"],
            ]),
        };
        const body = bandedPair(4, [0, 1, 2, 3, 4]);
        const neutral = readNeutralSet(set, archiveOf({ CDMB1G1: body, CDMB2G1: body }), { flavour: "tob" });

        expect(neutral.variants.map((variant) => variant.armour)).toEqual([1, 2]);
        expect([...neutral.variants[1]!.files.keys()]).toEqual(["CDMB2G1"]);
    });

    /**
     * A member the archive serves but no codec can read is dropped, not carried as a half-built entry.
     * BAM v2 arrives this way in practice - its frames live in PVRZ pages the reader cannot resolve - and
     * the same path catches a truncated or foreign file.
     */
    it("drops a file whose bytes no codec can parse", () => {
        const io = archiveOf({ CDMB1G1: bandedPair(4, [0, 1, 2, 3, 4]), CDMB1G1E: new Uint8Array([1, 2, 3]) });
        const neutral = readNeutralSet(characterSet(), io, { flavour: "tob" });

        expect([...neutral.variants[0]!.files.keys()]).toEqual(["CDMB1G1"]);
    });

    /**
     * An archive that lists a part and then fails to serve it - a stale index, or an install missing a
     * file its own key file still names. The readable part carries the action; the absent one is dropped.
     */
    it("skips a part the archive lists but cannot serve", () => {
        const files: Record<string, Uint8Array> = { CDMB1G1: bandedPair(4, [0, 1, 2, 3, 4]) };
        const io: StanceIo = { exists: (resref) => resref in files || resref === "CDMB1G1E", read: (r) => files[r] };
        const neutral = readNeutralSet(characterSet(), io, { flavour: "tob" });

        expect([...neutral.variants[0]!.files.keys()]).toEqual(["CDMB1G1"]);
        expect(neutral.variants[0]!.actions[0]!.resrefs).toEqual(["CDMB1G1"]);
    });

    /** Nothing the set names is present, so the scheme layer resolves no stance to build a variant from. */
    it("yields no variant when the archive holds none of the set's files", () => {
        expect(readNeutralSet(characterSet(), archiveOf({}), { flavour: "tob" }).variants).toEqual([]);
    });

    /**
     * Every part of every band unreadable is not an empty set with empty actions - it is no variant at all.
     * The stance layer tolerates it because it only needs one part's cycle table; this layer needs pixels.
     */
    it("yields no variant when every file it names is unparseable", () => {
        const junk = new Uint8Array([1, 2, 3]);
        const io = archiveOf({ CDMB1G1: junk, CDMB1G1E: junk });

        expect(readNeutralSet(characterSet(), io, { flavour: "tob" }).variants).toEqual([]);
    });
});

describe("writing a neutral set back to the game it came from", () => {
    it("reproduces every file byte for byte", () => {
        const files = { CDMB1G1: bandedPair(4, [0, 1, 2, 3, 4]), CDMB1G1E: bandedPair(4, [5, 6, 7]) };
        const neutral = readNeutralSet(characterSet(), archiveOf(files), { flavour: "tob" });

        const writes = writeNeutralSet(neutral);

        expect(writes.map((write) => write.resref)).toEqual(["CDMB1G1", "CDMB1G1E"]);
        for (const write of writes) expect(write.bytes).toEqual(files[write.resref as keyof typeof files]);
    });

    /**
     * A compressed member goes back compressed. Every classic install ships its animations as BAMC, so
     * this is the arm the corpus gate actually exercises - and writing a bare v1 where a BAMC was read
     * would still load in the game, which is why nothing downstream would report it.
     */
    it("re-encodes a member that arrived inside a BAMC container", () => {
        const io = archiveOf({ CDMB1G1: encodeBamc(bandedPair(4, [0, 1, 2, 3, 4])) });
        const neutral = readNeutralSet(characterSet(), io, { flavour: "tob" });

        const [write] = writeNeutralSet(neutral);

        expect(isBamc(write!.bytes)).toBe(true);
        expect(decodeBamc(write!.bytes)).toEqual(bandedPair(4, [0, 1, 2, 3, 4]));
    });

    it("writes a file once even when several actions draw it", () => {
        // One nine-block G1 file: nine actions, one file on disk.
        const io = archiveOf({ CDMB1G1: multiCycle(4, 72) });
        const neutral = readNeutralSet(characterSet(), io, { flavour: "tob" });

        expect(neutral.variants[0]!.actions.length).toBeGreaterThan(1);
        expect(writeNeutralSet(neutral).map((write) => write.resref)).toEqual(["CDMB1G1"]);
    });

    /**
     * The interpretation has to survive the round trip too, not just the pixels: a model that wrote the
     * bytes back perfectly while reading them differently the second time would pass a byte comparison
     * and still be unusable for conversion.
     */
    it("reads the same interpretation back out of what it wrote", () => {
        const files = { CDMB1G1: bandedPair(4, [0, 1, 2, 3, 4]) };
        const first = readNeutralSet(characterSet(), archiveOf(files), { flavour: "tob" });

        const written = Object.fromEntries(writeNeutralSet(first).map((w) => [w.resref, w.bytes]));
        const second = readNeutralSet(characterSet(), archiveOf(written), { flavour: "tob" });

        expect(second.variants[0]!.actions).toEqual(first.variants[0]!.actions);
    });

    /** One parsed member, narrowed to the indexed branch the reader always produces. */
    function oneIndexedMember(): { set: NeutralSet; parsed: IndexedAnimation } {
        const set = readNeutralSet(characterSet(), archiveOf({ CDMB1G1: multiCycle(4, 8) }), { flavour: "tob" });
        const parsed = set.variants[0]!.files.get("CDMB1G1")!;
        if (isRgbaAnimation(parsed)) throw new Error("a BAM v1 fixture parsed as true colour");
        return { set, parsed };
    }

    /** The same set, with its single member replaced. */
    function withMember(set: NeutralSet, animation: Animation): NeutralSet {
        const files = new Map([["CDMB1G1", animation]]);
        return { ...set, variants: [{ ...set.variants[0]!, files }] };
    }

    /**
     * The two refusals, asserted rather than assumed. A writer that silently emitted something for either
     * case would produce a file the game cannot draw, and the round-trip gate compares what it wrote - so
     * a wrong-but-parseable output is exactly what it would fail to notice.
     */
    it("refuses a true-colour animation, whose pixels live in pages it does not carry", () => {
        const { set, parsed } = oneIndexedMember();

        expect(() => writeNeutralSet(withMember(set, convertToRgba(parsed)))).toThrow(/CDMB1G1: a true-colour BAM/);
    });

    it("refuses a source format it has no writer for", () => {
        const { set, parsed } = oneIndexedMember();
        const foreign = { ...parsed, meta: { ...parsed.meta, sourceFormat: "frm" as const } };

        expect(() => writeNeutralSet(withMember(set, foreign))).toThrow(/CDMB1G1: no writer for source format "frm"/);
    });
});

/**
 * What a round trip must preserve, or the first thing it did not.
 *
 * Content, not bytes: the frame pool and its refs, every frame's pixels and placement, the palette and the
 * transparent index. This is the always-on tier of the gate - a difference here is data the model failed
 * to carry, whatever the file sizes say.
 *
 * One limit worth knowing when reading a green run: the serializer writes a frame's verbatim RLE stream
 * where it kept one (`payload()` in `image/src/bam/serialize.ts` prefers `rawEncoding` over `pixels`), so
 * for those frames the pixel comparison is comparing bytes the writer copied rather than pixels it
 * re-encoded. Corrupting one pixel per file is caught in 2181 of a classic install's 3907 files - the rest
 * are the verbatim ones, where the copy is what makes them lossless. The structural checks above - pool
 * size, cycle count, frame refs, facings, palette - have no such bypass and cover every file.
 */
function firstDifference(before: Animation, after: Animation): string | undefined {
    if (isRgbaAnimation(before) !== isRgbaAnimation(after)) return "colour model changed";
    if (before.frames.length !== after.frames.length) {
        return `frame pool ${before.frames.length} -> ${after.frames.length}`;
    }
    if (before.sequences.length !== after.sequences.length) {
        return `cycles ${before.sequences.length} -> ${after.sequences.length}`;
    }
    for (const [at, sequence] of before.sequences.entries()) {
        const other = after.sequences[at]!;
        if (sequence.frameRefs.join(",") !== other.frameRefs.join(",")) return `cycle ${at} frame refs`;
        if (sequence.facing !== other.facing) return `cycle ${at} facing`;
    }
    for (const [at, frame] of before.frames.entries()) {
        const other = after.frames[at]!;
        if (frame.width !== other.width || frame.height !== other.height) return `frame ${at} size`;
        if (frame.offsetX !== other.offsetX || frame.offsetY !== other.offsetY) return `frame ${at} offset`;
        if (frame.pixels.length !== other.pixels.length) return `frame ${at} pixel count`;
        for (let i = 0; i < frame.pixels.length; i++) {
            if (frame.pixels[i] !== other.pixels[i]) return `frame ${at} pixel ${i}`;
        }
    }
    if (!isRgbaAnimation(before) && !isRgbaAnimation(after)) {
        if (before.palette.length !== after.palette.length) return "palette length";
        for (const [at, colour] of before.palette.entries()) {
            const other = after.palette[at]!;
            if (colour.r !== other.r || colour.g !== other.g || colour.b !== other.b || colour.a !== other.a) {
                return `palette entry ${at}`;
            }
        }
        if ((before.meta.transparentIndex ?? 0) !== (after.meta.transparentIndex ?? 0)) return "transparent index";
    }
    return undefined;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
    return a.length === b.length && a.every((byte, at) => byte === b[at]);
}

/**
 * The BAM inside its container.
 *
 * The byte tier is measured here rather than on the file as it sits on disk, because BAMC is a zlib
 * wrapper and the shipped files were compressed at a different level than the encoder uses - a difference
 * in no byte the game reads, which would otherwise swamp the measurement at 100% of compressed files.
 */
function innerBytes(bytes: Uint8Array): Uint8Array {
    return isBamc(bytes) ? decodeBamc(bytes) : bytes;
}

/**
 * The gate the whole model rests on, over whatever install is on hand.
 *
 * Two tiers, and the split is deliberate. CONTENT equality is required of every file: it is what says the
 * model carried the frame pool, the refs, the pixels and the palette. BYTE equality is reported and floored
 * rather than required, because the v1 serializer lays a file out canonically - it writes each frame's
 * payload in turn rather than reusing one data block for two frame entries the way some shipped files do,
 * and it pads every palette to 256 entries (`image/src/bam/serialize.ts`). Both make a re-emitted file a
 * different size while losing nothing, which is why no file in the corpus differs at equal size.
 */
const GAME = process.env.BGFORGE_IE_GAME;

describe.skipIf(GAME === undefined)("the same-game round trip over a real install", () => {
    it("carries every file's content back out, and reports how many are byte-identical", () => {
        const game = openGame(GAME!);
        if (game === undefined) throw new Error(`no game at ${GAME}`);
        const io: StanceIo = {
            exists: (resref) => game.canRead(resref, "bam"),
            read: (resref) => (game.canRead(resref, "bam") ? game.read(resref, "bam") : undefined),
        };

        let files = 0;
        let identical = 0;
        const lost: string[] = [];
        // Per FILE, not per (set, file): sets alias onto one another's bodies - the gnome cleric draws the
        // dwarf's - so counting a file once per set that draws it would weight shared bodies several times
        // over and report a rate for a population that does not exist on disk.
        const measured = new Set<string>();
        for (const set of buildAnimationIndex(game, tableForFlavour(game.identity.flavour))) {
            const neutral = readNeutralSet(set, io, { flavour: game.identity.flavour });
            for (const write of writeNeutralSet(neutral)) {
                if (measured.has(write.resref)) continue;
                measured.add(write.resref);
                files += 1;
                const original = io.read(write.resref);
                if (original === undefined) {
                    lost.push(`${write.resref}: vanished`);
                    continue;
                }
                if (sameBytes(innerBytes(original), innerBytes(write.bytes))) identical += 1;
                const difference = firstDifference(
                    loadImage(original, `${write.resref}.BAM`),
                    loadImage(write.bytes, `${write.resref}.BAM`),
                );
                if (difference !== undefined) lost.push(`${write.resref}: ${difference}`);
            }
        }

        const percent = files === 0 ? 0 : Math.round((identical / files) * 100);
        process.stdout.write(`  ${files} files: content preserved for ${files - lost.length}, `);
        process.stdout.write(`${identical} (${percent}%) byte-identical inside the container\n`);
        expect(files, "no set resolved a file, so nothing was exercised").toBeGreaterThan(0);
        // Content is the requirement; the first twenty names make a failure readable.
        expect(lost.slice(0, 20)).toEqual([]);
        // A collapse detector, not a target. Canonical layout is why this is not 100: creature art reuses
        // one data block across many directions, and the serializer gives every frame its own, so the
        // files that share most are exactly the ones that come back larger. Measured at 36% over a classic
        // install's animation members - against 70% over every BAM it ships, GUI and fonts included, which
        // share nothing. The floor sits below the measurement so a real regression is what moves it.
        expect(percent).toBeGreaterThanOrEqual(30);
        // This one sweep parses, re-serializes and pixel-compares every animation file an install ships,
        // so it is the outlier rather than the suite's shape - it carries its own budget instead of
        // lifting the ceiling for every test in the file.
    }, 600000);
});
