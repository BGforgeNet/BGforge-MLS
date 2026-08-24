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

    /**
     * The two degradation paths, neither of which a corpus differential reaches: an id the install's tables do
     * not name (a script from a newer edition), and an `A:` parameter - an action passed as an argument, whose
     * storage the spec says outright it does not know, and which no stored record in the corpus carries.
     *
     * Both keep the file readable rather than failing it. The reference implementation refuses the whole script
     * on an unknown id, which is the wrong trade for a viewer: one unnamed call should not hide the other
     * ninety.
     */
    test("names what it can and marks what it cannot, rather than failing the script", () => {
        const trigger = (id: number): BcsTrigger => ({
            ints: [id, 0, 0, 0, 0],
            strings: ["", ""],
            object: { ints: Array.from({ length: 12 }, () => 0), string: "" },
        });
        const script = { blocks: [{ triggers: [trigger(0x4030), trigger(0x40e2), trigger(0x4099)], responses: [] }] };

        const baf = decompileBcs(script, {
            ...SYMBOLS,
            // 0x4030 is named, 0x40e2 is not, and 0x4099 takes an argument this cannot render.
            trigger: (id) => (id === 0x4030 ? ["False()"] : id === 0x4099 ? ["ActionListEmpty(A:Action*)"] : []),
        });

        expect(baf.split("\n").slice(0, 4)).toEqual([
            "IF",
            "  False()",
            "  UnknownTrigger16610()",
            "  UnknownTrigger16537()",
        ]);
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

/**
 * `TriggerOverride` is an artificial construct, and unlike `ActionOverride` it is built from a REAL stored
 * trigger: a `NextTriggerObject(O:Object*)` record standing in front of the trigger it retargets. The pair
 * folds into one line, and 198 stored records across 19 of a stock BG:EE's scripts do this.
 *
 * Matched on the name the install's table gives the id rather than on the id, which is what makes it engine
 * independent - BG2:ToB's TRIGGER.IDS carries no such row at all, so the fold simply never fires there.
 */
describe("TriggerOverride", () => {
    const NEXT_TRIGGER_OBJECT = 0x40e0;
    const FALSE = 0x4030;
    const OR = 0x4089;

    const ROWS = new Map([
        [NEXT_TRIGGER_OBJECT, "NextTriggerObject(O:Object*)"],
        [FALSE, "False()"],
        [OR, "OR(I:OrCount*)"],
    ]);
    const symbols: BcsSymbols = { ...SYMBOLS, trigger: (id) => rows(ROWS.get(id)) };

    function trigger(id: number, options: { negated?: boolean; ea?: number; count?: number } = {}): BcsTrigger {
        const ints = Array.from({ length: 12 }, () => 0);
        ints[0] = options.ea ?? 0;
        return {
            ints: [id, options.count ?? 0, options.negated === true ? 1 : 0, 0, 0],
            strings: ["", ""],
            object: { ints, string: "" },
        };
    }

    const decompile = (triggers: BcsTrigger[]): string[] =>
        decompileBcs({ blocks: [{ triggers, responses: [] }] }, symbols).split("\n");

    // The negation belongs to the trigger being retargeted, so it prints outside the wrapper.
    test("folds a NextTriggerObject into the trigger that follows it", () => {
        const lines = decompile([trigger(NEXT_TRIGGER_OBJECT, { ea: 2 }), trigger(FALSE, { negated: true })]);

        expect(lines).toEqual(["IF", "  !TriggerOverride([PC],False())", "THEN", "END", ""]);
    });

    // Two stored records, one condition: an `OR` counts the line, not the records behind it.
    test("a folded pair counts as one trigger toward an enclosing OR", () => {
        const lines = decompile([
            trigger(OR, { count: 2 }),
            trigger(NEXT_TRIGGER_OBJECT, { ea: 2 }),
            trigger(FALSE),
            trigger(FALSE),
        ]);

        expect(lines).toEqual(["IF", "  OR(2)", "    TriggerOverride([PC],False())", "    False()", "THEN", "END", ""]);
    });

    // Nothing follows it, so there is nothing to fold into and the record prints as the table names it.
    test("emits a trailing NextTriggerObject on its own", () => {
        const lines = decompile([trigger(FALSE), trigger(NEXT_TRIGGER_OBJECT, { ea: 2 })]);

        expect(lines).toEqual(["IF", "  False()", "  NextTriggerObject([PC])", "THEN", "END", ""]);
    });
});

/**
 * The spec calls a trigger's fifth stored number "an integer of unknown purpose". It is a third integer
 * ARGUMENT: `NearLocation(O:Object*,I:PointX*,I:PointY*,I:Range*)` takes three, and a stock BG:EE stores
 * `16611 423 0 290 7` for one - the range in the slot the spec says nothing uses. Four of its scripts diverge
 * from the reference implementation without this, each printing a range of 0 for a real one.
 */
test("a trigger's third integer argument comes from its fifth stored number", () => {
    const script = {
        blocks: [
            {
                triggers: [{ ints: [0x40e3, 423, 0, 290, 7], strings: ["", ""], object: { ints: [], string: "" } }],
                responses: [],
            },
        ],
    };

    const baf = decompileBcs(script, {
        ...SYMBOLS,
        trigger: (id) => rows(id === 0x40e3 ? "NearLocation(O:Object*,I:PointX*,I:PointY*,I:Range*)" : undefined),
    });

    expect(baf.split("\n")[1]).toBe("  NearLocation([ANYONE],423,290,7)");
});
