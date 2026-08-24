import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { decompileBcs, readBcs, type BcsSymbols, type BcsTrigger } from "@bgforge/bcs";

/**
 * Expected output is the reference implementation's, taken by decompiling these same fixtures with WeiDU
 * against BG2:ToB's IDS tables. It is the oracle for two rules the format spec does not state and that reading
 * `bcs.htm` alone gets wrong: an action's stored FIRST object is not one of its arguments but an acting-object
 * override, which prints as an `ActionOverride(...)` wrapper (no stored action carries the id ACTION.IDS gives
 * that name - 0 of 90852 across a stock BG:EE plus BG2:ToB pair), and its own object arguments therefore start
 * at the second slot.
 *
 * The tables below are the rows of BG2:ToB's real IDS files that these fixtures touch, so the test states its
 * own inputs rather than needing an install.
 */
const TRIGGERS = new Map([
    [0x400f, "Global(S:Name*,S:Area*,I:Value*)"],
    [0x4011, "HPGT(O:Object*,I:Hit Points*)"],
    [0x401c, "See(O:Object*)"],
    [0x4027, "Delay(I:Delay*)"],
    [0x4030, "False()"],
]);

// `ApplySpellRES` really does write its second parameter without the trailing `*` the others carry.
const ACTIONS = new Map([
    [3, "Attack(O:Target*)"],
    [23, "MoveToPoint(P:Point*)"],
    [29, "RunAwayFrom(O:Creature*,I:Time*)"],
    [30, "SetGlobal(S:Name*,S:Area*,I:Value*)"],
    [36, "Continue()"],
    [160, "ApplySpellRES(S:RES*,O:Target)"],
]);

// RACE.IDS has no key 0, which is why an unnamed race prints as `0` inside a bracket list below.
const IDS = new Map<string, Map<number, string>>([
    ["EA", new Map([[2, "PC"]])],
    ["GENERAL", new Map([[1, "HUMANOID"]])],
    ["RACE", new Map([[2, "ELF"]])],
    ["CLASS", new Map([[1, "MAGE"]])],
    ["OBJECT", new Map([[1, "Myself"]])],
]);

const rows = (signature: string | undefined): string[] => (signature === undefined ? [] : [signature]);

const SYMBOLS: BcsSymbols = {
    trigger: (id) => rows(TRIGGERS.get(id)),
    action: (id) => rows(ACTIONS.get(id)),
    ids: (table) => IDS.get(table),
};

function fixture(name: string): string {
    return fs.readFileSync(path.join(__dirname, "fixtures", `${name}.bcs`), "latin1");
}

describe("decompileBcs", () => {
    test("emits the block structure WeiDU emits", () => {
        const baf = decompileBcs(readBcs(fixture("standard")), SYMBOLS);

        expect(baf).toBe(
            [
                "IF",
                '  Global("AerieTransform","GLOBAL",0)',
                "  !HPGT([PC],2)",
                "THEN",
                "  RESPONSE #100",
                '    ApplySpellRES("J#Belt12",Myself)',
                '    SetGlobal("ACH_GODLIKE","GLOBAL",1)',
                "  RESPONSE #50",
                "    MoveToPoint([0.0])",
                "END",
                "",
                "IF",
                "THEN",
                "  RESPONSE #100",
                "    Continue()",
                "END",
                "",
            ].join("\n"),
        );
    });

    // Trailing zeroes are dropped from the bracket form, and a field the install's table does not name keeps
    // its number rather than being omitted - dropping it would shift every field after it onto a wrong name.
    test("renders an object's enumerated fields as a bracket list", () => {
        const baf = decompileBcs(readBcs(fixture("older-truncated")), SYMBOLS);

        expect(baf).toContain("See([PC.HUMANOID.0.MAGE])");
        expect(baf).toContain("Attack([PC.HUMANOID])");
    });

    test("emits a response that holds no actions", () => {
        const baf = decompileBcs(readBcs(fixture("empty-response")), SYMBOLS);

        expect(baf).toBe(["IF", "  False()", "THEN", "  RESPONSE #100", "END", ""].join("\n"));
    });

    /**
     * `OR(n)` makes the NEXT n triggers alternatives rather than a conjunction, so the reader has to see where
     * the group ends - the reference implementation indents them and so does this. The count is a real
     * argument, which is why a group running past the end of the condition just stops there.
     */
    test("indents the triggers an OR groups", () => {
        const trigger = (id: number, count = 0): BcsTrigger => ({
            ints: [id, count, 0, 0, 0],
            strings: ["", ""],
            object: { ints: Array.from({ length: 12 }, () => 0), string: "" },
        });
        const script = {
            blocks: [
                { triggers: [trigger(0x4089, 2), trigger(0x4030), trigger(0x4030), trigger(0x4030)], responses: [] },
            ],
        };

        const baf = decompileBcs(script, {
            ...SYMBOLS,
            trigger: (id) => (id === 0x4089 ? ["OR(I:OrCount*)"] : ["False()"]),
        });

        expect(baf).toBe(["IF", "  OR(2)", "    False()", "    False()", "  False()", "THEN", "END", ""].join("\n"));
    });

    test("emits nothing for a script with no blocks", () => {
        expect(decompileBcs(readBcs(fixture("blockless")), SYMBOLS)).toBe("");
    });

    // A condition with no response set still prints its IF/THEN - the file says the block is there.
    test("emits a block whose condition has no response set", () => {
        const baf = decompileBcs(readBcs(fixture("torment-object")), SYMBOLS);

        expect(baf).toBe(["IF", '  Global("","",0)', "THEN", "END", ""].join("\n"));
    });
});
