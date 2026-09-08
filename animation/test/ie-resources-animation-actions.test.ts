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
        // A7 ships in both installs and the published naming details only A1-A6, so what it depicts is
        // exactly what nothing has stated.
        expect(decodeActionCode("character", "A7")).toEqual({ scheme: "character", id: "unpinned", code: "A7" });
    });

    /**
     * The stances a character set keeps in its misc files.
     *
     * The published naming calls the whole `G` family "misc", which reads as unpinnable - but each file's
     * art sits in one band of the eleven-band skeleton they all carry, and that band's meaning IS pinned by
     * the block table the viewer already names them with. Measured per file on a classic and an Enhanced
     * install: `G11` draws the walk band, `G1` the first combat stance, `G19` the sleep.
     */
    it("reads a misc file as the stance its own band depicts", () => {
        expect(decodeActionCode("character", "G11")).toMatchObject({ id: "walk" });
        expect(decodeActionCode("character", "G1")).toMatchObject({ id: "ready", detail: "1-handed" });
        expect(decodeActionCode("character", "G19")).toMatchObject({ id: "sleep" });
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

    it("files a two-letter stance under the character misc file that draws it", () => {
        // The whole point of the misc band table: a monster's walk has a home in the character family, and
        // it is the file whose art sits in the walk band rather than the one whose name starts with G1.
        expect(encodeActionCodes("character", decodeActionCode("action-codes", "WK"))).toEqual([
            { code: "G11", detail: "kept" },
        ]);
    });

    it("has no name for an action the target scheme does not distinguish", () => {
        // The two-letter family has no paperdoll: it names animation files, and an inventory picture is not
        // one. Reported as a lost action rather than filed under a code that means something else.
        expect(encodeActionCodes("action-codes", decodeActionCode("character", "INV"))).toEqual([]);
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

    it("writes an action back under its own code when the target is the scheme it came from", () => {
        // Its own name, and only that one: a thrust re-filed as a backslash would be the converter
        // stating something the source contradicts, and a set written back to its own scheme has to
        // land on the files it was read from.
        expect(encodeActionCodes("character", decodeActionCode("character", "A5"))).toEqual([
            { code: "A5", detail: "kept" },
        ]);
    });

    it("keeps a band's own code even where its scheme names no actions at all", () => {
        // A packed file's band: the block table pinned what it depicts, while its code is the FILE's and
        // the cycle-numbered family has no table to look it up in. Writing it back has to put it in the
        // file it came out of, which nothing but its own code says.
        const band = { scheme: "cycle-numbers" as const, id: "walk" as const, code: "G1" };

        expect(encodeActionCodes("cycle-numbers", band)).toEqual([{ code: "G1", detail: "kept" }]);
        expect(encodeActionCodes("action-codes", band)).toEqual([{ code: "WK", detail: "kept" }]);
    });

    it("carries an unpinned code within its own scheme and nowhere else", () => {
        const misc = decodeActionCode("character", "A7");
        expect(encodeActionCodes("character", misc)).toEqual([{ code: "A7", detail: "kept" }]);
        expect(encodeActionCodes("action-codes", misc)).toEqual([]);
    });

    /**
     * The Fallout codes are the engine's own: its file-code builder writes `a` plus the animation's index
     * for the unarmed group, `b` plus the offset into the knockdown range for a death, and fixed pairs for
     * standing back up. So the table below is a decode of that arithmetic, not a reading of the filenames.
     */
    describe("the Fallout critter scheme", () => {
        it("names the actions the engine's unarmed group has a code for", () => {
            const named = (scheme: ActionScheme, code: string) =>
                encodeActionCodes("fallout-critter", decodeActionCode(scheme, code)).map((entry) => entry.code);

            expect(named("action-codes", "WK")).toContain("AB");
            expect(named("action-codes", "SD")).toContain("AA");
            expect(named("action-codes", "GH")).toContain("AO");
            expect(named("action-codes", "DE")).toContain("BA");
            expect(named("action-codes", "GU")).toContain("CH");
            expect(named("action-codes", "A1")).toContain("AQ");
        });

        /**
         * A combat stance is a weapon-out pose, and Fallout spells the weapon into the code's FIRST letter -
         * so every candidate for it names a weapon the source never stated. Left unnamed rather than filed
         * under a knife: the reader is told the action did not travel, which is true, where a knife-group
         * file would be a quiet invention.
         */
        it("names nothing for the actions Fallout's critter scheme has no counterpart for", () => {
            for (const code of ["SC", "SL", "TW"]) {
                expect(encodeActionCodes("fallout-critter", decodeActionCode("action-codes", code))).toEqual([]);
            }
        });

        /**
         * A spell is the one of these with somewhere to go: Fallout plays a hands-worked-in-front gesture
         * when a critter uses something, which is the same shape and a slot a converted creature must fill.
         * One code, not the trio - see the table for why its two neighbours are refused.
         */
        it("names the use gesture for a spell, which is the nearest shape that engine has", () => {
            for (const code of ["CA", "SP"]) {
                expect(encodeActionCodes("fallout-critter", decodeActionCode("action-codes", code))).toEqual([
                    { code: "AL", detail: "kept" },
                ]);
            }
        });
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
