/**
 * MAP writer: object variants, script-slot sizing, and the size guard - all without the external corpus.
 *
 * Every other MAP suite is corpus-driven: it loads real `.map` files from `external/`, behind
 * `skipIf(!hasExternalMaps)`. That is the right way to test a parser against reality, but it leaves the
 * writer's variant handling unverified anywhere the corpus is absent - a fresh clone, and Stryker's sandbox,
 * which excludes `external/` by configuration. Mutation testing is where that showed: the MAP writer scored
 * 57.86% with 13 mutants no test reached, because the tests that would have reached them had all skipped.
 *
 * So these documents are synthetic and committed. The invariant they guard is that the writer's two halves
 * agree: `objectsSerializedLength`/`scriptSectionLength` size the buffer, and the serialize functions fill
 * it. A disagreement either overflows the allocation or leaves a gap that shifts every following byte - which
 * on this format means corrupting a map the user cannot replace.
 *
 * All three elevations are present but carry no tile entries, so the tile section is 120KB of zeros. That is
 * deliberate: skipping the elevations makes a far smaller file, but the parser reads a per-elevation object
 * count only for a present elevation, so the objects under test would vanish.
 */

import { describe, expect, it } from "vitest";
import { mapParser } from "../src/map";
import { serializeMapCanonicalDocument, mapObjectsSectionStart } from "../src/map/canonical-writer";
import { type MapCanonicalDocument, PID_TYPE_CRITTER, PID_TYPE_MISC } from "../src/map/canonical-schemas";
import { PID_TYPE_ITEM } from "../src/map/parse-helpers";

/** The low end of the pid range `isExitGridPid` recognises, which is what the parser gates the block on. */
const FIRST_EXIT_GRID_PID = 0x5000010;
import { objectBaseSpec, inventoryHeaderSpec, critterDataSpec } from "../src/map/specs/object";
import { MAX_FILE_SIZES } from "../src/max-file-sizes";
import { isArraySpec, isCharsSpec, type FieldSpec } from "../src/spec/types";

/** All-zero record for a spec; flag fields project to `[]`, chars to `""`. */
function zeroRecord(spec: Record<string, FieldSpec>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(spec)) {
        const fs = spec[key]!;
        if (isCharsSpec(fs)) out[key] = "";
        else if (isArraySpec(fs))
            out[key] = Array.from({ length: typeof fs.count === "number" ? fs.count : 0 }, () => 0);
        else if (fs.flags) out[key] = [] as string[];
        else out[key] = 0;
    }
    return out;
}

/** A pid whose top byte is the object type the writer branches on. */
const pidOf = (type: number): number => (type << 24) >>> 0;
/** A sid whose top nibble is the script type that selects the slot layout. */
const sidOf = (type: number): number => ((type << 24) >>> 0) + 7;

type Obj = MapCanonicalDocument["objects"]["elevations"][number]["objects"][number];

/**
 * One object, distinguishable by `base.id`, of whichever variant the options select.
 *
 * The default pid type is WALL, not the more obvious scenery: item and scenery records carry a subtype-keyed
 * trailer the parser can only size through a PRO subtype resolver, and an unresolved pid makes it mark the
 * object incomplete and stop reading the whole elevation. A wall needs no resolver, so a plain filler object
 * stays a plain filler object.
 */
const PID_TYPE_WALL = 3;
function object(id: number, opts: Partial<Obj> & { pidType?: number } = {}): Obj {
    const { pidType = PID_TYPE_WALL, ...rest } = opts;
    const base = { ...zeroRecord(objectBaseSpec as Record<string, FieldSpec>), id, pid: pidOf(pidType) };
    return {
        kind: "unknown",
        base,
        inventoryHeader: zeroRecord(inventoryHeaderSpec as Record<string, FieldSpec>),
        inventory: [],
        ...rest,
    } as unknown as Obj;
}

const critterData = () => zeroRecord(critterDataSpec as Record<string, FieldSpec>);

function slot(scriptType: number): Record<string, unknown> {
    return {
        sid: sidOf(scriptType),
        nextScriptLinkLegacy: 0,
        flags: [] as string[],
        index: scriptType,
        programPointerSlot: 0,
        ownerId: 0,
        localVarsOffset: 0,
        numLocalVars: 0,
        returnValue: 0,
        action: 0,
        fixedParam: 0,
        actionBeingUsed: 0,
        scriptOverrides: 0,
        unknownField0x48: 0,
        checkMarginHowMuch: 0,
        legacyField0x50: 0,
        // Only the layout its script type selects carries these; the writer defaults the rest to 0.
        ...(scriptType === 1 ? { builtTile: 11, spatialRadius: 22 } : {}),
        ...(scriptType === 2 ? { timerTime: 33 } : {}),
    };
}

/**
 * The script sections a MAP carries, all empty.
 *
 * Not `[]`: the parser does not take the section count from the file, it probes 0..5 and scores the
 * candidates, and a document with no script section at all is degenerate enough to send that heuristic into
 * the objects section ("Script entry Entry 2 overflow"). Four is `STRICT_MAP_SCRIPT_TYPE_COUNT`, what the
 * strict path expects and what real files carry - and an all-zero-count set exercises the writer's
 * skip-empty-section path for free.
 */
const emptyScriptSections = (): MapCanonicalDocument["scripts"] =>
    Array.from({ length: 4 }, (_, type) => ({ type, count: 0, extents: [] })) as MapCanonicalDocument["scripts"];

/**
 * One script extent. Always SIXTEEN slots, whatever the list's `count` says: that is the on-disk shape - the
 * parser reads a fixed sixteen per extent and `count` only says how many are meaningful. The leading types
 * are the ones under test; the rest pad with the plain layout.
 */
function extent(...types: number[]): Record<string, unknown> {
    const slots = Array.from({ length: 16 }, (_, i) => slot(types[i] ?? 0));
    return { slots, extentLength: types.length, extentNext: -1 };
}

function doc(over: { objects?: Obj[][]; scripts?: MapCanonicalDocument["scripts"] }): MapCanonicalDocument {
    const perElevation = over.objects ?? [[], [], []];
    return {
        header: {
            version: 20,
            filename: "SYNTH.MAP",
            defaultPosition: 0,
            defaultElevation: 0,
            defaultOrientation: 0,
            numLocalVars: 0,
            scriptId: -1,
            // All three elevations PRESENT. Skipping them would keep the file small, but the parser reads a
            // per-elevation object count only for a present elevation, so a skipped one loses its objects
            // entirely - which is what the first draft of this fixture did. `tiles: []` below means the
            // reserved tile space is written as zeros, so the cost is 120KB of buffer and no allocation.
            flags: [],
            darkness: 0,
            numGlobalVars: 0,
            mapId: 0,
            timestamp: 0,
        },
        globalVariables: [],
        localVariables: [],
        tiles: [],
        scripts: over.scripts ?? emptyScriptSections(),
        objects: {
            totalObjects: perElevation.reduce((n, objs) => n + objs.length, 0),
            elevations: perElevation.map((objects, elevation) => ({
                elevation,
                objectCount: objects.length,
                objects,
            })),
        },
    } as unknown as MapCanonicalDocument;
}

/**
 * Serialize, reparse, and hand back the document the parser recovered.
 *
 * The reparse is the whole check, and it is deliberately the only one: comparing the byte length against
 * `objectsSerializedLength` would just restate the arithmetic the writer already used to size the buffer.
 * Reading the bytes back through the parser is independent of it - a length pass that disagrees with the
 * writer leaves a gap or an overlap, and the values below then land at the wrong index or fail to parse.
 */
function roundTrip(
    document: MapCanonicalDocument,
    pidResolver: (pid: number) => number | undefined = () => undefined,
): MapCanonicalDocument {
    // The resolver is explicit and defaults to "no subtype" because writer and parser learn about the
    // per-subtype trailer differently: the writer emits one iff the document carries `subtypeData`, while the
    // parser asks a resolver. Leaving the default in place would let the ambient pidtypes lookup answer for a
    // synthetic pid and read a trailer nothing wrote, misaligning every object after it.
    const parsed = mapParser.parse(serializeMapCanonicalDocument(document), { pidResolver });
    expect(parsed.errors).toBeUndefined();
    // `ParseResult.document` is the cross-format union; these bytes came from `mapParser`, so the member is
    // MAP's by construction, and the assertion above rules out the error path.
    return parsed.document as MapCanonicalDocument;
}

describe("MAP writer - each object variant round-trips at its own size", () => {
    it("a critter carries its 44-byte data block", () => {
        const back = roundTrip(
            doc({ objects: [[object(1, { pidType: PID_TYPE_CRITTER, critterData: critterData() as never })], [], []] }),
        );
        expect(back.objects.elevations[0]!.objects.map((o) => o.base.id)).toEqual([1]);
        expect(back.objects.elevations[0]!.objects[0]!.critterData).toBeDefined();
    });

    it("a misc object with an exit grid carries its extra 16 bytes", () => {
        // The pid has to be a real exit-grid pid, not merely a misc one: the writer emits the block for any
        // misc object carrying `exitGrid`, but the parser reads one only for the pids `isExitGridPid`
        // recognises. That asymmetry is invisible on corpus files, where an exitGrid only ever comes from an
        // object that had one - a synthetic document is the only place it bites.
        const exitGrid = { destinationMap: 3, destinationTile: 4, destinationElevation: 1, destinationRotation: 2 };
        const exitGridObject = object(2, { exitGrid: exitGrid as never });
        (exitGridObject.base as { pid: number }).pid = FIRST_EXIT_GRID_PID;

        const back = roundTrip(doc({ objects: [[exitGridObject], [], []] }));
        expect(back.objects.elevations[0]!.objects[0]!.exitGrid).toMatchObject(exitGrid);
    });

    it("subtype trailer values are written at four bytes each", () => {
        // The trailer is the one part of the object layout no constant pins: the length pass multiplies
        // `values.length` by four and the writer walks the same array. Subtype 3 is a weapon, whose trailer is
        // two int32s - so the resolver has to say 3 for the parser to read back what the writer emitted.
        const itemObject = object(3, { subtypeData: { subType: 3, values: [101, 202] } as never });
        (itemObject.base as { pid: number }).pid = pidOf(PID_TYPE_ITEM);

        const back = roundTrip(doc({ objects: [[itemObject], [], []] }), () => 3);
        expect(back.objects.elevations[0]!.objects[0]!.subtypeData?.values).toEqual([101, 202]);
    });

    it("nested inventory recurses through both the length pass and the writer", () => {
        // Recursion is where a length/write disagreement compounds: the outer object's size depends on the
        // inner one's, so an error at depth 2 moves everything after the whole tree.
        const inner = object(11);
        const outer = object(10, { inventory: [{ quantity: 5, object: inner }] as never });
        const back = roundTrip(doc({ objects: [[outer, object(12)], [], []] }));

        const first = back.objects.elevations[0]!.objects[0]!;
        expect(first.base.id).toBe(10);
        expect(first.inventory.map((e) => e.quantity)).toEqual([5]);
        expect(first.inventory[0]!.object.base.id).toBe(11);
        // The object AFTER the tree is where a mis-sized inventory lands wrongly.
        expect(back.objects.elevations[0]!.objects[1]!.base.id).toBe(12);
    });

    it("objects spread across elevations keep their elevation and order", () => {
        const back = roundTrip(doc({ objects: [[object(1), object(2)], [object(3)], [object(4), object(5)]] }));
        expect(back.objects.totalObjects).toBe(5);
        expect(back.objects.elevations.map((e) => e.objects.map((o) => o.base.id))).toEqual([[1, 2], [3], [4, 5]]);
    });
});

describe("MAP writer - the object data header and its guards", () => {
    it("carries a non-zero dataFlags word", () => {
        // Every other fixture here leaves dataFlags at 0, which is indistinguishable from not writing it at
        // all into a zeroed buffer - so the write itself needs a value that is not the buffer's default.
        // A plain u32 in the canonical doc, not a flag array - the flag names live in the display tree, and
        // the writer emits the word.
        const flagged = object(20, { objectData: { dataFlags: 0x0f00_0001 } as never });
        const back = roundTrip(doc({ objects: [[flagged], [], []] }));
        expect(back.objects.elevations[0]!.objects[0]!.objectData?.dataFlags).toBe(0x0f00_0001);
    });

    it("refuses a critter object with no critter data rather than writing a short record", () => {
        // The alternative is a 44-byte hole: the length pass reserves the block from the pid type alone, so
        // without this the buffer would be sized for data the writer never supplies and every following
        // object would read from inside the gap.
        const headless = object(21, { pidType: PID_TYPE_CRITTER });
        expect(() => serializeMapCanonicalDocument(doc({ objects: [[headless], [], []] }))).toThrow(
            /critterData is required/,
        );
    });

    it("gives a misc object without an exit grid no exit-grid block", () => {
        // The misc branch is conditional on the object actually carrying the field. A misc object that does
        // not must occupy 16 bytes less, and the object after it is where a wrongly-reserved block shows up.
        const plainMisc = object(22, { pidType: PID_TYPE_MISC });
        const back = roundTrip(doc({ objects: [[plainMisc, object(23)], [], []] }));
        expect(back.objects.elevations[0]!.objects[0]!.exitGrid).toBeUndefined();
        expect(back.objects.elevations[0]!.objects.map((o) => o.base.id)).toEqual([22, 23]);
    });

    it("reports where the objects section starts, agreeing with where the writer puts it", () => {
        // `mapObjectsSectionStart` is exported for the opaque-range shifting in entity-ops, and it recomputes
        // the prefix length independently of the writer. If the two ever disagree, a structural edit
        // re-anchors ranges to the wrong place - so read the objects count back at the offset it claims.
        const document = doc({ objects: [[object(30), object(31)], [object(32)], []] });
        const bytes = serializeMapCanonicalDocument(document);
        const start = mapObjectsSectionStart(document);

        expect(new DataView(bytes.buffer, bytes.byteOffset + start, 4).getInt32(0, false)).toBe(3);
    });
});

describe("MAP writer - script slots are sized by the type packed in their sid", () => {
    it("spatial, timer and plain slots each round-trip at their own width", () => {
        // Three slots of different widths in one extent: if the length pass and the writer disagree on any
        // one of them, the slots after it are read from the wrong offset.
        const scripts = emptyScriptSections();
        scripts[1] = {
            type: 1,
            count: 3,
            extents: [extent(1, 2, 0)],
        } as unknown as MapCanonicalDocument["scripts"][number];
        const back = roundTrip(doc({ scripts }));

        const slots = back.scripts[1]!.extents[0]!.slots;
        // Sixteen slots on disk whatever `count` says; the three under test lead, and their `index` field
        // carries the script type so a mis-sized slot shows up as the next one being read from the wrong
        // offset rather than as a byte-level diff.
        expect(slots).toHaveLength(16);
        expect(slots.slice(0, 3).map((s) => s.index)).toEqual([1, 2, 0]);
        expect(slots[0]!.builtTile).toBe(11);
        expect(slots[0]!.spatialRadius).toBe(22);
        expect(slots[1]!.timerTime).toBe(33);
    });

    it("a zero-count section writes its count and nothing else", () => {
        // The `continue` on count 0 is what keeps an empty section to its 4-byte count; without it the
        // extents would be written into space the length pass never reserved.
        const withEmpty = emptyScriptSections();
        withEmpty[2] = {
            type: 2,
            count: 1,
            extents: [extent(0)],
        } as unknown as MapCanonicalDocument["scripts"][number];
        const back = roundTrip(doc({ scripts: withEmpty }));
        // Sections 0 and 1 are empty and must occupy their four count bytes and nothing more, or the
        // populated section after them would be read from the wrong offset.
        expect(back.scripts[0]!.count).toBe(0);
        expect(back.scripts[1]!.count).toBe(0);
        expect(back.scripts[0]!.extents).toEqual([]);
        // The populated section is only found at the right offset if the two empty ones before it wrote
        // exactly their four count bytes each.
        expect(back.scripts[2]!.count).toBe(1);
        expect(back.scripts[2]!.extents[0]!.slots).toHaveLength(16);
    });

    it("treats count as authoritative over a stale extents array", () => {
        // `count` is what both halves of the writer branch on, so a document whose count says zero while its
        // extents array still holds slots - a hand-edited snapshot, or an edit that cleared the count - must
        // write only the four count bytes. Writing the extents would emit bytes the length pass never
        // reserved, and the parser reads the count, so it would never look for them.
        const stale = emptyScriptSections();
        stale[0] = { type: 0, count: 0, extents: [extent(1, 2)] } as unknown as MapCanonicalDocument["scripts"][number];

        const withStale = serializeMapCanonicalDocument(doc({ scripts: stale }));
        const withoutStale = serializeMapCanonicalDocument(doc({ scripts: emptyScriptSections() }));
        expect(withStale.length).toBe(withoutStale.length);
        expect([...withStale]).toEqual([...withoutStale]);
    });
});

describe("MAP writer - refuses to allocate past the format's size envelope", () => {
    it("throws before allocating, naming every section's size input", () => {
        const budget = MAX_FILE_SIZES.map!;
        // A bare `length` rather than a real array: the guard runs before any element is read, and the
        // length pass over variables needs nothing else, so this reaches the check without allocating the
        // sixteen megabytes the guard exists to refuse.
        const oversized = {
            ...doc({}),
            globalVariables: { length: Math.ceil(budget / 4) + 1 },
        } as unknown as MapCanonicalDocument;

        expect(() => serializeMapCanonicalDocument(oversized)).toThrow(
            new RegExp(
                [
                    "map snapshot would expand to \\d+ bytes",
                    `globalVariables: ${oversized.globalVariables.length}`,
                    "localVariables: \\d+",
                    "scripts: \\d+",
                    "top-level objects: \\d+",
                    `${budget} byte budget`,
                ].join(".*"),
            ),
        );
    });
});
