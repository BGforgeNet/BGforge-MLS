import { describe, expect, it } from "vitest";
import {
    ACTION_SCHEME_CODES,
    type ActionScheme,
    decodeActionCode,
    encodeActionCodes,
} from "../src/animation-schemes/actions";

describe("reading a scheme's action code", () => {
    it("reads a character attack as an attack with the grip its name pins", () => {
        expect(decodeActionCode("character", "A5")).toEqual({
            scheme: "character",
            id: "attack",
            code: "A5",
            detail: "1-handed thrust",
        });
    });

    it("reads an action-code scheme's ranged attack as a shot", () => {
        // The two schemes number attacks differently: A4 is the ranged one here and a two-handed backslash
        // in the character scheme, which is why a code never travels between schemes uninterpreted.
        expect(decodeActionCode("action-codes", "A4")).toMatchObject({ id: "shoot" });
        expect(decodeActionCode("character", "A4")).toMatchObject({ id: "attack" });
    });

    it("leaves a code the documentation does not pin unpinned, keeping it verbatim", () => {
        expect(decodeActionCode("character", "G13")).toEqual({ scheme: "character", id: "unpinned", code: "G13" });
    });

    it("reads both spell codes as spellcasting, without saying which half each is", () => {
        // The published naming and the engine's own playback order invert build-up against release, so the
        // vocabulary keeps what both agree on - this is a spell - and pins no further.
        expect(decodeActionCode("action-codes", "CA").id).toBe("spell");
        expect(decodeActionCode("action-codes", "SP").id).toBe("spell");
    });

    it("leaves a cycle-numbered member unpinned, whatever it is called", () => {
        expect(decodeActionCode("cycle-numbers", "G2")).toEqual({
            scheme: "cycle-numbers",
            id: "unpinned",
            code: "G2",
        });
    });
});

describe("naming an action in a target scheme", () => {
    it("names a walk that both schemes have", () => {
        const walk = decodeActionCode("action-codes", "WK");
        expect(encodeActionCodes("action-codes", walk)).toEqual([{ code: "WK", detail: "kept" }]);
    });

    it("has no name for an action the target scheme does not distinguish", () => {
        // The character scheme names no walk at all: its walking art is one of the unpinned misc codes.
        // Reported as a lost action rather than filed under a code that means something else.
        expect(encodeActionCodes("character", decodeActionCode("action-codes", "WK"))).toEqual([]);
    });

    it("drops a detail the target's names do not carry", () => {
        const overhead = decodeActionCode("character", "A1");
        expect(encodeActionCodes("action-codes", overhead)).toEqual([
            { code: "A1", detail: "dropped" },
            { code: "A2", detail: "dropped" },
            { code: "A3", detail: "dropped" },
        ]);
    });

    it("offers every weapon the target distinguishes when the source named none", () => {
        // A shot that says only "ranged" has to be filed under a weapon here, so each candidate says the
        // weapon is an assumption rather than something the source stated.
        expect(encodeActionCodes("character", decodeActionCode("action-codes", "A4"))).toEqual([
            { code: "SA", detail: "assumed" },
            { code: "SS", detail: "assumed" },
            { code: "SX", detail: "assumed" },
        ]);
    });

    it("offers a candidate only for the grip it names", () => {
        // Never another grip's code: naming a thrust as a backslash would be the converter stating
        // something the source contradicts, which is worse than having no name for it.
        expect(encodeActionCodes("character", decodeActionCode("character", "A5"))).toEqual([
            { code: "A5", detail: "kept" },
        ]);
    });

    it("carries an unpinned code within its own scheme and nowhere else", () => {
        const misc = decodeActionCode("character", "G13");
        expect(encodeActionCodes("character", misc)).toEqual([{ code: "G13", detail: "kept" }]);
        expect(encodeActionCodes("action-codes", misc)).toEqual([]);
    });

    it("round-trips every code of every scheme through its own table", () => {
        // A table typo shows up here rather than as a converted set whose files the reader that produced
        // them cannot resolve: same scheme in and out, so the code that comes back must be the one that
        // went in - for the pinned entries and the unpinned ones alike.
        for (const [scheme, codes] of Object.entries(ACTION_SCHEME_CODES)) {
            for (const code of codes) {
                const decoded = decodeActionCode(scheme as ActionScheme, code);
                expect(encodeActionCodes(scheme as ActionScheme, decoded)[0]).toEqual({ code, detail: "kept" });
            }
        }
    });
});
