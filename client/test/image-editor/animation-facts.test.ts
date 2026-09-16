import { describe, expect, it } from "vitest";
import { animationFacts } from "../../src/image-editor/webview/render/animation-facts";
import type { AnimationView, SetView } from "../../src/image-editor/webview/messages";
import { type DirectionBlocks, directionBlocks } from "../../src/image-editor/webview/render/compass-layout";
import { familyDescription, sectionLabel } from "@bgforge/animation";
import { ieFacingsForStride } from "@bgforge/image/ie-direction";

function view(overrides: Partial<AnimationView> = {}): AnimationView {
    return {
        colorModel: "indexed",
        palette: [],
        hasSidecarPal: false,
        externalPaletteActive: false,
        frames: [],
        pixels: new ArrayBuffer(0),
        sequences: [],
        meta: { sourceFormat: "bam" },
        basename: "MDKNG1.BAM",
        sourceFormat: "bam",
        composedFiles: 1,
        ...overrides,
    } as AnimationView;
}

/**
 * A set view as the host builds one. `section` and `familyLabel` travel together and the label comes from
 * the real spelling, because that is the pair `setView` emits - a hand-written label here would let the
 * facts pass over a section the animation package does not actually name.
 */
function set(overrides: Partial<SetView> & { section?: string } = {}): SetView {
    const { section, ...rest } = overrides;
    return {
        id: 0x2300,
        title: "DEATH_KNIGHT",
        armours: [],
        armour: 1,
        stances: [],
        stance: "",
        band: 0,
        // The facts read nothing from these, so the emptiest shape the type takes is the honest fixture.
        saveOptions: { namings: [], sections: [], source: { storeEast: false }, overridePath: "" },
        ...(section === undefined
            ? {}
            : {
                  section,
                  familyLabel: sectionLabel(section),
                  familyTitle: familyDescription(section, "cycles"),
              }),
        ...rest,
    };
}

/** The blocks App resolves for the view - only the fields these facts read. */
function blocks(overrides: Partial<DirectionBlocks> = {}): DirectionBlocks {
    return { groups: [], ...overrides } as DirectionBlocks;
}

/**
 * One band's slots as the band reader hands them over: the first `count` of the wheel's own facing order.
 *
 * Taken from the published order rather than written out here, so a fixture claiming ten stored slots holds
 * the ten the reader would actually keep.
 */
function slots(count: number): DirectionBlocks["groups"][number] {
    return ieFacingsForStride(16)
        .slice(0, count)
        .map((facing, seqIndex) => ({ facing, seqIndex }));
}

function labelled(facts: ReturnType<typeof animationFacts>, id: string): string | undefined {
    return facts.find((fact) => fact.id === id)?.label;
}

describe("animationFacts directions", () => {
    /** The eight-slot scheme stores its whole band; the reader gets eight facings from it. */
    it("reads an eight-slot band as eight directions", () => {
        const facts = animationFacts({ view: view(), blocks: blocks({ scheme: "ie8", detected: true }) });

        expect(labelled(facts, "directions")).toBe("8 directions");
    });

    /**
     * The finer scheme stores nine cycles covering the WESTERN half of a sixteen-point wheel. Reporting
     * nine would name the cycle count, not the directions - the engine draws sixteen.
     */
    it("reads a nine-cycle band as sixteen directions, not nine", () => {
        const facts = animationFacts({ view: view(), blocks: blocks({ scheme: "ie9", detected: true }) });

        expect(labelled(facts, "directions")).toBe("16 directions");
        expect(labelled(facts, "mirrored")).toBe("east mirrored");
    });

    /**
     * A block read the interpreter did not confirm is a guess, and the header does not make it.
     *
     * Nothing structural separates an item icon's two cycles from the leading two of a real eight-slot
     * band, so the width is neither named nor denied until a declaration or the interpreter's own
     * fingerprint says which.
     */
    it("says the directions are unknown for a block read nothing confirms", () => {
        const facts = animationFacts({ view: view(), blocks: blocks({ scheme: "ie8", detected: false }) });

        expect(labelled(facts, "directions")).toBe("directions unknown");
        expect(labelled(facts, "mirrored")).toBeUndefined();
    });

    /**
     * Through the reader that actually produces the blocks rather than a hand-written shape.
     *
     * Measured on wm_chao.bam, a two-cycle spell graphic the header called eight directions with its east
     * mirrored. Two cycles are short of every scheme's stored arc, so this is the settled negative rather
     * than the unknown above: the reader hands back no blocks at all.
     */
    it("says no directions for a two-cycle file read through the real block reader", () => {
        // The file's own header: two one-frame cycles over two 32x32 frames anchored at the origin.
        const spellGraphic = view({
            sequences: [
                { frameRefs: [0], facing: "none", dirOffsetX: 0, dirOffsetY: 0 },
                { frameRefs: [1], facing: "none", dirOffsetX: 0, dirOffsetY: 0 },
            ],
            frames: [
                { width: 32, height: 32, offsetX: 0, offsetY: 0 },
                { width: 32, height: 32, offsetX: 0, offsetY: 0 },
            ],
        });

        expect(directionBlocks(spellGraphic)).toBeUndefined();

        const facts = animationFacts({ view: spellGraphic, blocks: directionBlocks(spellGraphic) });

        expect(labelled(facts, "directions")).toBe("no directions");
        expect(labelled(facts, "mirrored")).toBeUndefined();
    });

    /** Nothing is mirrored here, so the chip is absent: a header says what is unusual, not what is normal. */
    it("says nothing about mirroring for a band that stores every facing", () => {
        const facts = animationFacts({
            view: view({ set: set({ bands: { stride: 16 } }) }),
            blocks: blocks({ declared: true, groups: [slots(16)] }),
        });

        expect(labelled(facts, "directions")).toBe("16 directions");
        expect(labelled(facts, "mirrored")).toBeUndefined();
    });

    /**
     * A wide band whose eastern slots are flat padding stores fewer facings than its declared width, and
     * the band reader has already dropped them - so the stride answers what the ENGINE draws and the blocks
     * answer what the file holds. Reading the stride for both said every facing was stored and left the
     * quadrant families' half-empty wheel unexplained. Measured on WYVERN_BIG, whose walk band holds ten.
     */
    it("calls a wide band's padded slots mirrored rather than claiming it stores every facing", () => {
        const facts = animationFacts({
            view: view({ set: set({ bands: { stride: 16 } }) }),
            blocks: blocks({ declared: true, groups: [slots(10)] }),
        });

        expect(labelled(facts, "directions")).toBe("16 directions");
        expect(labelled(facts, "mirrored")).toBe("east mirrored");
        expect(facts.find((fact) => fact.id === "mirrored")?.title).toContain("10 of 16");
    });

    /** An FRM tags its own six rotations, so nothing has to be inferred from block structure. */
    it("reads an FRM's tagged rotations as six stored directions", () => {
        const facts = animationFacts({
            view: view({
                sourceFormat: "frm",
                meta: { sourceFormat: "frm" },
                sequences: (["S", "SE", "E", "NE", "N", "NW"] as const).map((facing) => ({
                    frameRefs: [0],
                    facing,
                    dirOffsetX: 0,
                    dirOffsetY: 0,
                })),
            }),
            blocks: undefined,
        });

        expect(labelled(facts, "directions")).toBe("6 directions");
        expect(labelled(facts, "mirrored")).toBeUndefined();
    });

    /** Not every FRM is a critter: one whose rotations are untagged has cycles that are not directions. */
    it("reads an FRM with no tagged rotations as no directions", () => {
        const facts = animationFacts({
            view: view({
                sourceFormat: "frm",
                meta: { sourceFormat: "frm" },
                sequences: [{ frameRefs: [0], facing: "none", dirOffsetX: 0, dirOffsetY: 0 }],
            }),
            blocks: undefined,
        });

        expect(labelled(facts, "directions")).toBe("no directions");
    });

    /** Blocks that fit neither scheme and a set declaring no band width leave nothing to report. */
    it("says no directions for blocks in no scheme the install declares a width for", () => {
        const facts = animationFacts({ view: view({ set: set() }), blocks: blocks({ declared: true }) });

        expect(labelled(facts, "directions")).toBe("no directions");
    });

    it("says so when the cycles are not directions at all", () => {
        const facts = animationFacts({ view: view(), blocks: undefined });

        expect(labelled(facts, "directions")).toBe("no directions");
        expect(labelled(facts, "mirrored")).toBeUndefined();
    });
});

describe("animationFacts mirroring", () => {
    /**
     * A lone eight-slot base file carries art in five slots and leaves the eastern three as dummies for
     * the engine to mirror. Combined with its eastern twin all eight are real - which is the difference
     * this fact exists to show, and the one nothing in the picture reveals.
     */
    it("calls a lone eight-slot base file's east mirrored", () => {
        const facts = animationFacts({
            view: view({ composedFiles: 1 }),
            blocks: blocks({ scheme: "ie8", detected: true }),
        });

        expect(labelled(facts, "mirrored")).toBe("east mirrored");
    });

    it("says nothing about mirroring for a base-and-east pair, which stores all eight", () => {
        const facts = animationFacts({
            view: view({ composedFiles: 2 }),
            blocks: blocks({ scheme: "ie8", detected: true }),
        });

        expect(labelled(facts, "mirrored")).toBeUndefined();
    });

    /** The count belongs in the tooltip: "east mirrored" alone does not say how much is real art. */
    it("says how many facings are stored behind the mirrored chip", () => {
        const facts = animationFacts({ view: view(), blocks: blocks({ scheme: "ie9", detected: true }) });

        expect(facts.find((fact) => fact.id === "mirrored")?.title).toContain("9 of 16");
    });
});

describe("animationFacts composition", () => {
    it("says how many files one picture was combined from", () => {
        expect(labelled(animationFacts({ view: view({ composedFiles: 1 }), blocks: undefined }), "files")).toBe(
            "1 file",
        );
        expect(labelled(animationFacts({ view: view({ composedFiles: 2 }), blocks: undefined }), "files")).toBe(
            "2 files",
        );
        expect(labelled(animationFacts({ view: view({ composedFiles: 6 }), blocks: undefined }), "files")).toBe(
            "6 files",
        );
    });
});

describe("animationFacts family", () => {
    /** The install's own declaration, spelled for a reader - and the multi-part families named as such. */
    it("names the family the install declares", () => {
        const facts = animationFacts({ view: view({ set: set({ section: "multi_new" }) }), blocks: undefined });

        expect(labelled(facts, "family")).toBe("Multi-part");
    });

    /**
     * The label is the install's vocabulary and answers nothing on its own. The sentence behind it is the
     * host's - which engine declares it, under what token, and what its files look like.
     */
    it("carries the host's whole sentence as the family's tooltip", () => {
        const facts = animationFacts({
            view: view({ set: set({ section: "monster_layered_spell" }) }),
            blocks: undefined,
        });

        expect(facts.find((fact) => fact.id === "family")?.title).toBe(
            familyDescription("monster_layered_spell", "cycles"),
        );
    });

    it("names no family for a file opened on its own", () => {
        expect(labelled(animationFacts({ view: view(), blocks: undefined }), "family")).toBeUndefined();
    });

    /** A set whose install declared no section has nothing to say, rather than an invented default. */
    it("names no family for a set the install declared no section for", () => {
        const facts = animationFacts({ view: view({ set: set() }), blocks: undefined });

        expect(labelled(facts, "family")).toBeUndefined();
    });
});

describe("animationFacts tooltips", () => {
    /** Each chip is two words; what it means has to be reachable without reading the source. */
    it("gives every fact a tooltip saying more than its label", () => {
        const facts = animationFacts({
            view: view({ composedFiles: 2, set: set({ section: "character" }) }),
            blocks: blocks({ scheme: "ie8", detected: true }),
        });

        expect(facts.length).toBeGreaterThan(2);
        for (const fact of facts) {
            expect(fact.title.length).toBeGreaterThan(fact.label.length);
        }
    });
});
