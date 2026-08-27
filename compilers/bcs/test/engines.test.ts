import { describe, expect, test } from "vitest";
import { decompileBcs, readBcs, writeBcs, type BcsEngine, type BcsSymbols } from "@bgforge/bcs";

/**
 * The object and trigger shapes engines other than BG store.
 *
 * These are hand-built from the layouts the reference implementation keeps per engine, because no Torment or
 * Icewind Dale corpus is available here - so unlike the BG side, which is gated against 4741 real scripts,
 * these are spec-faithful rather than corpus-verified. What they DO establish is that the codec stays
 * engine-free: it reads these by shape alone, with nothing told to it about which game a file came from.
 *
 * The layouts, in stored order:
 *
 * - BG    12 numbers, name
 * - IWD   12 numbers, rectangle, name
 * - PST   14 numbers (EA is followed by FACTION and TEAM), rectangle, name
 * - IWD2  13 numbers (a SUBRACE follows ALIGNMNT), rectangle, name, then two MORE numbers
 *
 * An object's rectangle is four dot-separated numbers, `-1` meaning unused. A PST trigger also carries a
 * point, and that one is COMMA-separated - the two bracket forms are not interchangeable.
 */
function script(objectLine: string, triggerHead = '16399 0 0 0 0 "" "" '): string {
    return `SC\nCR\nCO\nTR\n${triggerHead}OB\n${objectLine}OB\nTR\nCO\nRS\nRS\nCR\nSC\n`;
}

const OBJECTS: { engine: string; line: string; ints: number; region?: number[]; trailing?: number[] }[] = [
    { engine: "BG", line: '0 0 0 0 0 0 0 0 0 0 0 0 ""', ints: 12 },
    { engine: "IWD", line: '0 0 0 0 0 0 0 0 0 0 0 0 [-1.-1.-1.-1] ""', ints: 12, region: [-1, -1, -1, -1] },
    { engine: "PST", line: '2 5 6 0 0 0 0 0 0 0 0 0 0 0 [10.20.30.40] "bob"', ints: 14, region: [10, 20, 30, 40] },
    {
        engine: "IWD2",
        line: '0 0 0 0 0 0 0 0 0 0 0 0 0 [-1.-1.-1.-1] "" 7 8 ',
        ints: 13,
        region: [-1, -1, -1, -1],
        trailing: [7, 8],
    },
];

describe("objects from every engine", () => {
    test.each(OBJECTS.map((o) => [o.engine, o] as const))("%s round-trips byte-identically", (_engine, shape) => {
        const text = script(shape.line);

        expect(writeBcs(readBcs(text))).toBe(text);
    });

    test.each(OBJECTS.map((o) => [o.engine, o] as const))("%s reads into the right parts", (_engine, shape) => {
        const object = readBcs(script(shape.line)).blocks[0]!.triggers[0]!.object;

        expect(object.ints).toHaveLength(shape.ints);
        expect(object.region).toEqual(shape.region);
        expect(object.trailingInts).toEqual(shape.trailing);
    });

    /**
     * The identifier chain is always the five numbers immediately before the rectangle - or before the name
     * where an engine stores no rectangle. That is what lets one reader serve every engine: the token stream
     * says where the split is, so nothing has to know which game produced the file.
     */
    test("the last five numbers before the rectangle are the identifier chain", () => {
        const pst = '0 0 0 0 0 0 0 0 0 1 2 3 4 5 [-1.-1.-1.-1] ""';

        const object = readBcs(script(pst)).blocks[0]!.triggers[0]!.object;

        expect(object.ints.slice(-5)).toEqual([1, 2, 3, 4, 5]);
    });
});

describe("a PST trigger's point", () => {
    // Comma-separated, and it sits among the numbers rather than after the strings.
    const head = '16399 0 0 0 0 [100,200] "a" "b" ';

    test("round-trips byte-identically", () => {
        const text = script('0 0 0 0 0 0 0 0 0 0 0 0 ""', head);

        expect(writeBcs(readBcs(text))).toBe(text);
    });

    test("reads as a point beside the trigger's own numbers", () => {
        const trigger = readBcs(script('0 0 0 0 0 0 0 0 0 0 0 0 ""', head)).blocks[0]!.triggers[0]!;

        expect(trigger.ints).toEqual([16399, 0, 0, 0, 0]);
        expect(trigger.point).toEqual([100, 200]);
        expect(trigger.strings).toEqual(["a", "b"]);
    });
});

/**
 * What the DECOMPILER has to know about the engine, which is only ever how to NAME what the codec already
 * read. Three things vary: which IDS table names each enumerated object field, one lookup key IWD2 builds from
 * two fields, and where a stored coordinate goes.
 *
 * Same caveat as above - the reference implementation's rules, not a corpus's.
 */

// `See` is 0x401c in every table these games ship; the stub answers only that id so a wrong id shows up as
// `UnknownTrigger`.
const SEE = 16412;

function symbols(tables: Record<string, Record<number, string>>, row = "See(O:Object*)"): BcsSymbols {
    return {
        trigger: (id) => (id === SEE ? [row] : []),
        action: () => [],
        ids: (table) => {
            const rows = tables[table];
            return rows === undefined
                ? undefined
                : new Map(Object.entries(rows).map(([key, name]) => [Number(key), name]));
        },
    };
}

function seeing(objectLine: string, engine: BcsEngine, tables: Record<string, Record<number, string>>): string {
    const text = script(objectLine, `${SEE} 0 0 0 0 "" "" `);
    return decompileBcs(readBcs(text), symbols(tables), engine).split("\n")[1]!.trim();
}

describe("naming an object's fields per engine", () => {
    /**
     * PST puts FACTION and TEAM straight after EA, so the same two stored numbers that BG reads as GENERAL and
     * RACE are a different pair of tables here. Nothing about the record says which - only the engine does.
     */
    test("PST reads the second and third fields as FACTION and TEAM", () => {
        const line = '2 5 6 0 0 0 0 0 0 0 0 0 0 0 [-1.-1.-1.-1] ""';
        const tables = { EA: { 2: "PC" }, FACTION: { 5: "FACTION_MERCYKILLER" }, TEAM: { 6: "TEAM_EVIL" } };

        expect(seeing(line, "pst", tables)).toBe("See([PC.FACTION_MERCYKILLER.TEAM_EVIL])");
    });

    /**
     * IWD2's last two fields are stored AFTER the name, but they are the ninth and tenth entries of one target
     * list and print in the bracket like any other - so the trailing-zero trim has to run over the whole list,
     * not over the numbers that happen to precede the name.
     */
    test("IWD2 prints the two fields stored after the name in list position", () => {
        const line = '2 0 0 0 0 0 0 0 0 0 0 0 0 [-1.-1.-1.-1] "" 4 0 ';
        const tables = { EA: { 2: "PC" }, AVCLASS: { 4: "CLERIC" } };

        expect(seeing(line, "iwd2", tables)).toBe("See([PC.0.0.0.0.0.0.0.CLERIC])");
    });

    /**
     * IWD2 alone keys SUBRACE by the RACE it belongs to, packing the race into the high half of the lookup
     * value - the stored subrace number means nothing on its own. A combination the table does not name falls
     * back to the number the file actually holds, not to the combined key.
     */
    test("IWD2 looks a SUBRACE up under its RACE", () => {
        const line = '0 0 1 0 0 0 0 2 0 0 0 0 0 [-1.-1.-1.-1] "" 0 0 ';
        const tables = { RACE: { 1: "HUMAN" }, SUBRACE: { 0x1_0002: "HUMAN_WERERAT" } };

        expect(seeing(line, "iwd2", tables)).toBe("See([0.0.HUMAN.0.0.0.0.HUMAN_WERERAT])");
        expect(seeing(line, "iwd2", { RACE: { 1: "HUMAN" } })).toBe("See([0.0.HUMAN.0.0.0.0.2])");
    });

    // BG is the engine with no coordinates and no extra fields, and it stays exactly as it was.
    test("BG reads the second and third fields as GENERAL and RACE", () => {
        const line = '2 1 2 0 0 0 0 0 0 0 0 0 ""';
        const tables = { EA: { 2: "PC" }, GENERAL: { 1: "HUMANOID" }, RACE: { 2: "ELF" } };

        expect(seeing(line, "bg", tables)).toBe("See([PC.HUMANOID.ELF])");
    });
});

describe("an object's rectangle", () => {
    // It prints last - outside the identifier wrapping, not inside the bracket list.
    test("follows the whole object expression", () => {
        const line = '2 0 0 0 0 0 0 0 0 0 0 1 [10.20.30.40] ""';
        const tables = { EA: { 2: "PC" }, OBJECT: { 1: "Myself" } };

        expect(seeing(line, "iwd", tables)).toBe("See(Myself([PC])[10.20.30.40])");
    });

    // All -1 means unused, which is what a record that simply has the field stores.
    test("is omitted when every side is unused", () => {
        const line = '2 0 0 0 0 0 0 0 0 0 0 0 [-1.-1.-1.-1] ""';

        expect(seeing(line, "iwd", { EA: { 2: "PC" } })).toBe("See([PC])");
    });
});

/**
 * A PST trigger's stored point is its `P:` argument. The name below is a stand-in: no Torment install is
 * available here to read a real point-taking row off, and the behaviour under test is which stored field the
 * argument is drawn from, not what the row is called.
 */
test("a PST trigger's stored point fills its point argument", () => {
    const text = script('0 0 0 0 0 0 0 0 0 0 0 0 ""', `${SEE} 0 0 0 0 [100,200] "" "" `);

    const baf = decompileBcs(readBcs(text), symbols({}, "PointTrigger(P:Point*)"), "pst");

    expect(baf.split("\n")[1]!.trim()).toBe("PointTrigger([100.200])");
});
