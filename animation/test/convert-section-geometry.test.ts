/**
 * The section-to-geometry table, against the install it was measured on.
 *
 * The table states what each declared section's TYPE stores, taken from the published documentation. This
 * checks it against the archive: a section whose sets hold an eastern companion must be one the table calls
 * east-stored, and one whose sets hold none must be one it calls east-computed. A row that drifts from the
 * install it describes is a set written in a shape the engine will not read.
 */
import { describe, expect, it } from "vitest";
import { openGame } from "@bgforge/binary";
import { buildAnimationIndex } from "../src/animation-index";
import { tableForFlavour } from "../src/animation-tables";
import { drawnArmourLevels, setMembers, stanceIo } from "../src/set-stances";
import { targetForSection } from "../src/convert/target";

const GAME = process.env.BGFORGE_IE_GAME;

describe("targetForSection", () => {
    it("gives no geometry to the families whose shape these profiles cannot express", () => {
        // Sixteen slots holding eight pictures; sixteen spread across a base and a companion; two
        // geometries chosen by a field this project does not read; and a family with no directions at all.
        expect(targetForSection("monster_quadrant")).toBeUndefined();
        expect(targetForSection("monster_large16")).toBeUndefined();
        expect(targetForSection("monster_ankheg")).toBeUndefined();
        expect(targetForSection("effect")).toBeUndefined();
    });

    it("gives no geometry to a header this project has no spelling for", () => {
        expect(targetForSection("some_mods_own_header")).toBeUndefined();
    });

    it("separates the families that compute their east from the ones that store it", () => {
        expect(targetForSection("monster")?.pairEast).toBe(false);
        expect(targetForSection("monster_old")?.pairEast).toBe(true);
    });
});

describe.skipIf(GAME === undefined)("the table against a real install", () => {
    it("calls a section east-stored exactly where its sets ship companion files", () => {
        const game = openGame(GAME!);
        expect(game, `no game at ${GAME}`).toBeDefined();
        const io = stanceIo(game!);

        /** Per section, whether any member holds a `<base>E` companion, and whether any holds none. */
        const seen = new Map<string, { withEast: number; withoutEast: number }>();
        for (const set of buildAnimationIndex(game!, tableForFlavour(game!.identity.flavour))) {
            const section = set.section;
            if (section === undefined || targetForSection(section) === undefined) continue;
            const tally = seen.get(section) ?? { withEast: 0, withoutEast: 0 };
            for (const armour of drawnArmourLevels(set, io.exists)) {
                for (const member of setMembers(set, armour, io.exists)) {
                    // The companion is the part named `<base>E`, not any part ending in E - the action-code
                    // families spell a death `DE`, which a suffix test would count as a companion.
                    const [base] = member.parts;
                    if (base !== undefined && member.parts.includes(`${base}E`)) tally.withEast += 1;
                    else tally.withoutEast += 1;
                }
            }
            seen.set(section, tally);
        }

        process.stdout.write(`  ${seen.size} sections with a geometry checked\n`);
        expect(seen.size, "this install ships no section the table covers, so nothing was exercised").toBeGreaterThan(
            0,
        );
        const wrong: string[] = [];
        for (const [section, tally] of seen) {
            const stored = targetForSection(section)?.pairEast === true;
            // The majority, not every member: a set that ships an incomplete member holds no companion for
            // it, which says nothing about the family's own shape.
            const majorityStored = tally.withEast > tally.withoutEast;
            if (stored !== majorityStored) {
                wrong.push(
                    `${section}: table says ${stored ? "stored" : "computed"}, ` +
                        `archive holds ${tally.withEast} with a companion and ${tally.withoutEast} without`,
                );
            }
        }
        expect(wrong).toEqual([]);
    });
});
