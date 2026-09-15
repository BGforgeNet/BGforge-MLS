import { describe, expect, it } from "vitest";
import { openGame } from "@bgforge/binary";
import { AREA_BITMAPS, ICON_FAMILIES, UNTAGGED, matchesTag, resourceTags, tagsFor } from "../src/gallery/resource-tags";

const EE_GAME = process.env.BGFORGE_IE_GAME;

describe("tagsFor", () => {
    it("tags an icon by its name family", () => {
        expect(tagsFor("ISCRL01", "bam")).toEqual(["scroll"]);
    });

    it("tags a family that shares no letters with its label", () => {
        expect(tagsFor("IAMUL28", "bam")).toEqual(["amulet"]);
    });

    it("matches the family regardless of case", () => {
        expect(tagsFor("ipotn12", "BAM")).toEqual(["potion"]);
    });

    it("leaves an unlisted family untagged rather than guessing one", () => {
        expect(tagsFor("IZZZZ9", "bam")).toEqual([]);
    });

    it("leaves a name that is not an icon untagged", () => {
        expect(tagsFor("CEFW2SA", "bam")).toEqual([]);
    });

    it("leaves a name too short to carry a family untagged", () => {
        expect(tagsFor("ISCR", "bam")).toEqual([]);
    });

    it("does not read an icon family off a file that is not a BAM", () => {
        expect(tagsFor("ISCRL01", "bmp")).toEqual([]);
    });

    it("tags an area bitmap by the suffix naming its role", () => {
        expect(tagsFor("AR0072SR", "bmp")).toEqual(["area search map"]);
        expect(tagsFor("AR0072HT", "bmp")).toEqual(["area height map"]);
        expect(tagsFor("AR0072LM", "bmp")).toEqual(["area light map"]);
        expect(tagsFor("AR1900LN", "bmp")).toEqual(["area light map (night)"]);
    });

    it("tags an area bitmap whose area is not named AR", () => {
        expect(tagsFor("XR5405SR", "bmp")).toEqual(["area search map"]);
    });

    it("leaves a bitmap whose stem is not an area resref untagged", () => {
        // A portrait's size letter after a stem ending in L reads as the light-map suffix; the stem shape is
        // what tells the two apart.
        expect(tagsFor("SHARTELM", "bmp")).toEqual([]);
        expect(tagsFor("NOPORTLM", "bmp")).toEqual([]);
    });

    it("does not read an area suffix off a file that is not a BMP", () => {
        expect(tagsFor("AR0072SR", "bam")).toEqual([]);
    });
});

describe("resourceTags", () => {
    const bam = (label: string): { label: string; ext: string } => ({ label, ext: "bam" });

    it("lists the tags present among a set of items, sorted, without repeats", () => {
        expect(resourceTags([bam("ISCRL01"), bam("ISCRL02"), bam("IAMUL28")])).toEqual(["amulet", "scroll"]);
    });

    it("offers the untagged option when some item carries no tag", () => {
        expect(resourceTags([bam("ISCRL01"), bam("CEFW2SA")])).toEqual(["scroll", UNTAGGED]);
    });

    it("omits the untagged option when every item is tagged", () => {
        expect(resourceTags([bam("ISCRL01"), bam("IAMUL28")])).toEqual(["amulet", "scroll"]);
    });

    it("offers the untagged option alone when nothing is tagged", () => {
        expect(resourceTags([bam("CEFW2SA"), bam("MPLYBOW")])).toEqual([UNTAGGED]);
    });

    it("mixes the tags of every format present", () => {
        expect(resourceTags([bam("ISCRL01"), { label: "AR0072SR", ext: "bmp" }])).toEqual([
            "area search map",
            "scroll",
        ]);
    });
});

describe("matchesTag", () => {
    it("passes everything when no type is chosen", () => {
        expect(matchesTag("CEFW2SA", "bam", "")).toBe(true);
        expect(matchesTag("ISCRL01", "bam", "")).toBe(true);
    });

    it("keeps an item carrying the chosen tag", () => {
        expect(matchesTag("ISCRL01", "bam", "scroll")).toBe(true);
    });

    it("drops an item carrying a different tag", () => {
        expect(matchesTag("IAMUL28", "bam", "scroll")).toBe(false);
    });

    it("keeps only untagged items under the untagged option", () => {
        expect(matchesTag("CEFW2SA", "bam", UNTAGGED)).toBe(true);
        expect(matchesTag("ISCRL01", "bam", UNTAGGED)).toBe(false);
    });

    /**
     * The sentinel travels the same channel as a real tag, so a family whose label happened to equal it would
     * silently merge the two - every file of that family filed under "no type".
     */
    it("uses a sentinel no table's label can collide with", () => {
        expect([...Object.values(ICON_FAMILIES), ...Object.values(AREA_BITMAPS)]).not.toContain(UNTAGGED);
    });
});

describe.skipIf(EE_GAME === undefined)("over a real install", () => {
    /**
     * The tables are deliberately partial, so the tagged share is information rather than a threshold - a
     * coverage floor here would just be the current tables' size restated as a requirement.
     *
     * What CAN regress is the other direction: a name outside the tables must stay untagged, or the filter
     * starts mislabelling a mod's own files. That is the only assertion.
     */
    it("tags no icon whose family the table does not list", () => {
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
            const got = tagsFor(resref, "bam");
            if (listed === undefined ? got.length > 0 : got[0] !== listed) wrong.push(resref);
            if (got.length > 0) tagged += 1;
        }
        expect(wrong).toEqual([]);
        expect(tagged, "no icon matched the table at all - the corpus cannot show a mismatch").toBeGreaterThan(0);
    });

    /**
     * The area rule has an oracle the icon rule does not: an area's bitmaps are named after the area, so the
     * stem should carry a WED. The two exceptions are real - an install ships light maps for two areas whose
     * WED it does not - so the assertion is that every tagged stem is area-SHAPED and every untagged BMP that
     * a WED does back stays untagged only because its suffix is not one of the four.
     */
    it("tags an area bitmap only where the name is an area's", () => {
        const game = openGame(EE_GAME!);
        expect(game, `no game at ${EE_GAME}`).toBeDefined();
        const bitmaps = game!.list().filter((ref) => ref.ext?.toLowerCase() === "bmp");
        expect(bitmaps.length, "an install with no BMPs cannot exercise this").toBeGreaterThan(0);
        const areas = new Set(
            game!
                .list()
                .filter((ref) => ref.ext?.toLowerCase() === "wed")
                .map((ref) => ref.resref.toUpperCase()),
        );

        let tagged = 0;
        const wrongRole: string[] = [];
        const missed: string[] = [];
        for (const { resref } of bitmaps) {
            const name = resref.toUpperCase();
            const [tag] = tagsFor(resref, "bmp");
            const role = AREA_BITMAPS[name.slice(-2)];
            if (tag === undefined) {
                // Untagged is only correct where the name is not an area's bitmap at all.
                if (role !== undefined && areas.has(name.slice(0, -2))) missed.push(name);
                continue;
            }
            tagged += 1;
            if (tag !== role) wrongRole.push(name);
        }
        expect(wrongRole).toEqual([]);
        expect(missed).toEqual([]);
        expect(tagged, "no bitmap matched the table at all - the corpus cannot show a mismatch").toBeGreaterThan(0);
    });
});
