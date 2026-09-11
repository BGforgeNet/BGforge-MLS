import { describe, expect, it } from "vitest";
import { animationFacts } from "../../src/image-editor/webview/render/animation-facts";
import type { AnimationView, SetView } from "../../src/image-editor/webview/messages";
import type { DirectionBlocks } from "../../src/image-editor/webview/render/compass-layout";
import { familyDescription, sectionLabel } from "@bgforge/animation";

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

function labelled(facts: ReturnType<typeof animationFacts>, id: string): string | undefined {
    return facts.find((fact) => fact.id === id)?.label;
}

describe("animationFacts directions", () => {
    /** The eight-slot scheme stores its whole band; the reader gets eight facings from it. */
    it("reads an eight-slot band as eight directions", () => {
        const facts = animationFacts({ view: view(), blocks: blocks({ scheme: "ie8" }) });

        expect(labelled(facts, "directions")).toBe("8 directions");
    });

    /**
     * The finer scheme stores nine cycles covering the WESTERN half of a sixteen-point wheel. Reporting
     * nine would name the cycle count, not the directions - the engine draws sixteen.
     */
    it("reads a nine-cycle band as sixteen directions, not nine", () => {
        const facts = animationFacts({ view: view(), blocks: blocks({ scheme: "ie9" }) });

        expect(labelled(facts, "directions")).toBe("16 directions");
        expect(labelled(facts, "mirrored")).toBe("east mirrored");
    });

    /** Nothing is mirrored here, so the chip is absent: a header says what is unusual, not what is normal. */
    it("says nothing about mirroring for a band that stores every facing", () => {
        const facts = animationFacts({
            view: view({ set: set({ bands: { stride: 16 } }) }),
            blocks: blocks({ declared: true }),
        });

        expect(labelled(facts, "directions")).toBe("16 directions");
        expect(labelled(facts, "mirrored")).toBeUndefined();
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
        const facts = animationFacts({ view: view({ composedFiles: 1 }), blocks: blocks({ scheme: "ie8" }) });

        expect(labelled(facts, "mirrored")).toBe("east mirrored");
    });

    it("says nothing about mirroring for a base-and-east pair, which stores all eight", () => {
        const facts = animationFacts({ view: view({ composedFiles: 2 }), blocks: blocks({ scheme: "ie8" }) });

        expect(labelled(facts, "mirrored")).toBeUndefined();
    });

    /** The count belongs in the tooltip: "east mirrored" alone does not say how much is real art. */
    it("says how many facings are stored behind the mirrored chip", () => {
        const facts = animationFacts({ view: view(), blocks: blocks({ scheme: "ie9" }) });

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
            blocks: blocks({ scheme: "ie8" }),
        });

        expect(facts.length).toBeGreaterThan(2);
        for (const fact of facts) {
            expect(fact.title.length).toBeGreaterThan(fact.label.length);
        }
    });
});
