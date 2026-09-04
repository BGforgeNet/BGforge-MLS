import { describe, expect, it } from "vitest";
import { openGame } from "@bgforge/binary";
import { ICON_FAMILIES, iconTags, tagsFor } from "../src/gallery/icon-tags";

const EE_GAME = process.env.BGFORGE_IE_GAME;

describe("tagsFor", () => {
    it("tags an icon by its name family", () => {
        expect(tagsFor("ISCRL01")).toEqual(["scroll"]);
    });

    it("tags a family that shares no letters with its label", () => {
        expect(tagsFor("IAMUL28")).toEqual(["amulet"]);
    });

    it("matches the family regardless of case", () => {
        expect(tagsFor("ipotn12")).toEqual(["potion"]);
    });

    it("leaves an unlisted family untagged rather than guessing one", () => {
        expect(tagsFor("IZZZZ9")).toEqual([]);
    });

    it("leaves a name that is not an icon untagged", () => {
        expect(tagsFor("CEFW2SA")).toEqual([]);
    });

    it("leaves a name too short to carry a family untagged", () => {
        expect(tagsFor("ISCR")).toEqual([]);
    });
});

describe("iconTags", () => {
    it("lists the tags present among a set of names, sorted, without repeats", () => {
        expect(iconTags(["ISCRL01", "ISCRL02", "IAMUL28", "CEFW2SA"])).toEqual(["amulet", "scroll"]);
    });
});

describe.skipIf(EE_GAME === undefined)("over a real install's icons", () => {
    /**
     * The table is deliberately partial, so the tagged share is information rather than a threshold - a
     * coverage floor here would just be the current table's size restated as a requirement.
     *
     * What CAN regress is the other direction: a name outside the table must stay untagged, or the filter
     * starts mislabelling a mod's own icons. That is the only assertion.
     */
    it("tags no name whose family the table does not list", () => {
        const game = openGame(EE_GAME!);
        expect(game, `no game at ${EE_GAME}`).toBeDefined();
        const icons = game!
            .list()
            .filter((ref) => ref.ext?.toLowerCase() === "bam" && ref.resref.toUpperCase().startsWith("I"));
        expect(icons.length, "an install with no I* BAMs cannot exercise this").toBeGreaterThan(0);

        // The table read straight, independently of the lookup: a name is tagged exactly when its first
        // five characters are a key. Catches a lookup that matched on a substring, on the wrong length, or
        // that missed a family because the install spells its names in another case.
        const wrong: string[] = [];
        let tagged = 0;
        for (const { resref } of icons) {
            const listed = ICON_FAMILIES[resref.slice(0, 5).toUpperCase()];
            const got = tagsFor(resref);
            if (listed === undefined ? got.length > 0 : got[0] !== listed) wrong.push(resref);
            if (got.length > 0) tagged += 1;
        }
        expect(wrong).toEqual([]);
        expect(tagged, "no icon matched the table at all - the corpus cannot show a mismatch").toBeGreaterThan(0);
    });
});
