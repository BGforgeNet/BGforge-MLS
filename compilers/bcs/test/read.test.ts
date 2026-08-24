import { describe, expect, test } from "vitest";
import { readBcs } from "@bgforge/bcs";

/**
 * A BCS is plain ASCII: nested two-letter block markers with numeric and quoted fields between them. The
 * reader is deliberately name-agnostic - it reads the numbers a script stores and never resolves one to an
 * ACTION.IDS or TRIGGER.IDS name, because which table applies depends on the install rather than the file.
 *
 * The argument list is fixed, and IESDP's bcs.htm gives it: a trigger takes 7 arguments (its id, an integer,
 * a flags dword, an integer, an integer of unknown purpose, two strings, one object) and an action takes 10
 * (its id, three objects, an integer, a point written as two integers, two integers, two strings). Both are
 * meant to be written in full "even if they are not all used". Confirmed over 4939 non-empty files from a
 * stock BG:EE plus BG2:ToB pair: 121376 of 121435 triggers and 90801 of 90852 actions carry exactly five
 * numbers and two strings, every object carries twelve numbers, and the handful of exceptions all come from
 * one older writer that stops early.
 *
 * The records still hold their numbers as a list rather than as named fields, because WHICH field a number
 * is depends on the engine - the spec gives an object 12 numbers here, 14 on Torment, and a coordinate pair
 * on everything but BG1. Naming them is a later layer's job, and one that needs to know the engine.
 */

const MINIMAL = [
    "SC",
    "CR",
    "CO",
    "TR",
    "16412 0OB",
    '2 1 0 1 0 0 0 0 0 0 0 0 ""OB',
    "TR",
    "CO",
    "RS",
    "RE",
    "100AC",
    "29OB",
    '0 0 0 0 0 0 0 0 0 0 0 0 ""OB',
    "OB",
    '2 1 0 1 0 0 0 0 0 0 0 0 ""OB',
    "OB",
    '0 0 0 0 0 0 0 0 0 0 0 0 ""OB',
    "50 0 0 0 69AC",
    "RE",
    "RS",
    "CR",
    "SC",
    "",
].join("\n");

const WITH_STRINGS = [
    "SC",
    "CR",
    "CO",
    "TR",
    '16399 0 0 0 0 "LOCALSAerieHasProperPortrait" "" OB',
    '0 0 0 0 0 0 0 0 0 0 0 0 ""OB',
    "TR",
    "CO",
    "RS",
    "RE",
    "100AC",
    "160OB",
    '0 0 0 0 0 0 0 0 0 0 0 0 ""OB',
    "OB",
    '0 0 0 0 0 0 0 0 0 0 0 0 ""OB',
    "OB",
    '0 0 0 0 0 0 0 0 0 0 0 0 ""OB',
    '3745 0 0 0 0"J#Belt12" "CDHLYSYM" AC',
    "RE",
    "RS",
    "CR",
    "SC",
    "",
].join("\n");

describe("readBcs - structure", () => {
    test("reads a script's condition-response blocks", () => {
        const script = readBcs(MINIMAL);

        expect(script.blocks).toHaveLength(1);
        expect(script.blocks[0]!.triggers).toHaveLength(1);
        expect(script.blocks[0]!.responses).toHaveLength(1);
    });

    test("reads a response's weight and its actions", () => {
        const response = readBcs(MINIMAL).blocks[0]!.responses[0]!;

        expect(response.weight).toBe(100);
        expect(response.actions).toHaveLength(1);
    });

    test("reads an action's id and its three objects", () => {
        const action = readBcs(MINIMAL).blocks[0]!.responses[0]!.actions[0]!;

        expect(action.id).toBe(29);
        expect(action.objects).toHaveLength(3);
        expect(action.objects[1]!.ints.slice(0, 4)).toEqual([2, 1, 0, 1]);
    });

    test("reads a trigger's fields and its single object", () => {
        const trigger = readBcs(MINIMAL).blocks[0]!.triggers[0]!;

        expect(trigger.ints).toEqual([16412, 0]);
        expect(trigger.object.ints).toHaveLength(12);
    });

    test("reads a script with no blocks, which is markers and nothing else", () => {
        // 28 of the 4941 corpus files are exactly `SC` and `SC` - a script that is present and does
        // nothing, which is not the same as a file with no script in it.
        expect(readBcs("SC\nSC\n").blocks).toEqual([]);
    });

    test("refuses a file with no bytes, rather than reading it as an empty script", () => {
        // Two more corpus files are zero bytes. Reading one as a blockless script would write two markers
        // into it on the way out, so the two cases stay distinct at the boundary.
        expect(() => readBcs("")).toThrow(/Empty file/);
    });
});

describe("readBcs - the fields a record carries", () => {
    test("keeps a trigger's quoted fields", () => {
        const trigger = readBcs(WITH_STRINGS).blocks[0]!.triggers[0]!;

        expect(trigger.strings).toEqual(["LOCALSAerieHasProperPortrait", ""]);
    });

    test("keeps an action's quoted fields", () => {
        const action = readBcs(WITH_STRINGS).blocks[0]!.responses[0]!.actions[0]!;

        expect(action.ints).toEqual([3745, 0, 0, 0, 0]);
        expect(action.strings).toEqual(["J#Belt12", "CDHLYSYM"]);
    });

    test("distinguishes a record with no quoted fields from one with two empty ones", () => {
        // The BG1-era writer omits both quoted fields rather than writing a pair of empty ones, and 22 of
        // the corpus files still do. Reading them as `["", ""]` would add four bytes on the way out.
        const older = readBcs(MINIMAL).blocks[0]!.triggers[0]!;
        const newer = readBcs(WITH_STRINGS).blocks[0]!.triggers[0]!;

        expect(older.strings).toEqual([]);
        expect(newer.strings).toHaveLength(2);
    });

    test("keeps an object's single quoted field", () => {
        const object = readBcs(WITH_STRINGS).blocks[0]!.triggers[0]!.object;

        expect(object.string).toBe("");
    });
});

describe("readBcs - records with fields missing", () => {
    test("reads a response with no weight as weight zero", () => {
        const text = ["SC", "CR", "CO", "CO", "RS", "RE", "RE", "RS", "CR", "SC", ""].join("\n");

        expect(readBcs(text).blocks[0]!.responses[0]!).toEqual({ weight: 0, actions: [] });
    });

    test("reads an object with no quoted field as an empty one", () => {
        const text = ["SC", "CR", "CO", "TR", "1 0OB", "0 0 0OB", "TR", "CO", "RS", "RS", "CR", "SC", ""].join("\n");

        expect(readBcs(text).blocks[0]!.triggers[0]!.object).toEqual({ ints: [0, 0, 0], string: "" });
    });
});

describe("readBcs - the older truncated form", () => {
    // The spec says all seven of a trigger's arguments are written "even if they are not all used", and
    // 121376 of 121435 real triggers do. 59 of them, across 20 BG1-era files, stop after two numbers and
    // write no strings at all - and 51 actions across 22 files write their five numbers and no strings.
    // Reading a missing field as a zero or an empty string would put it back on the way out.
    test("reads a trigger that stops before its remaining fields", () => {
        const text = [
            "SC",
            "CR",
            "CO",
            "TR",
            "16412 0OB",
            '2 1 0 1 0 0 0 0 0 0 0 0 ""OB',
            "TR",
            "CO",
            "RS",
            "RS",
            "CR",
            "SC",
            "",
        ].join("\n");

        const trigger = readBcs(text).blocks[0]!.triggers[0]!;

        expect(trigger.ints).toEqual([16412, 0]);
        expect(trigger.strings).toEqual([]);
    });

    test("reads an action that writes its numbers and no strings", () => {
        const object = '0 0 0 0 0 0 0 0 0 0 0 0 ""OB';
        const text = [
            "SC",
            "CR",
            "CO",
            "CO",
            "RS",
            "RE",
            "100AC",
            "29OB",
            object,
            "OB",
            object,
            "OB",
            object,
            "50 0 0 0 69AC",
            "RE",
            "RS",
            "CR",
            "SC",
            "",
        ].join("\n");

        const action = readBcs(text).blocks[0]!.responses[0]!.actions[0]!;

        expect(action.ints).toEqual([50, 0, 0, 0, 69]);
        expect(action.strings).toEqual([]);
    });
});

describe("readBcs - a digit inside a name is not a field", () => {
    // The trap that a line-shaped reading falls straight into: an object's name is a quoted string, and
    // plenty of real ones end in a digit (`"HOUSEN2"`, `"Druid3"`). Counting numbers across the whole line
    // reads that digit as a thirteenth field, which is how a survey of this corpus can report objects of
    // 12, 13 and 14 numbers when every one of them has 12.
    test("reads an object whose name ends in a digit as twelve numbers", () => {
        const text = [
            "SC",
            "CR",
            "CO",
            "TR",
            '1 0 0 0 0 "" "" OB',
            '0 0 0 0 0 0 0 0 0 0 0 0 "HOUSEN2"OB',
            "TR",
            "CO",
            "RS",
            "RS",
            "CR",
            "SC",
            "",
        ].join("\n");

        const object = readBcs(text).blocks[0]!.triggers[0]!.object;

        expect(object.ints).toHaveLength(12);
        expect(object.string).toBe("HOUSEN2");
    });

    test("reads a name that is entirely digits as a string, not as fields", () => {
        const text = [
            "SC",
            "CR",
            "CO",
            "TR",
            '1 0 0 0 0 "12" "34" OB',
            '0 0 0 0 0 0 0 0 0 0 0 0 "567"OB',
            "TR",
            "CO",
            "RS",
            "RS",
            "CR",
            "SC",
            "",
        ].join("\n");

        const trigger = readBcs(text).blocks[0]!.triggers[0]!;

        expect(trigger.ints).toEqual([1, 0, 0, 0, 0]);
        expect(trigger.strings).toEqual(["12", "34"]);
        expect(trigger.object.ints).toHaveLength(12);
    });
});

describe("readBcs - engine variants", () => {
    test("reads Torment's two extra object fields, which are just two more numbers", () => {
        // The spec gives a Torment object a TEAM and a FACTION the other engines do not have. Nothing in
        // the reader has to change for that: it is two more numbers in the same list.
        const wide = `${Array.from({ length: 14 }, () => 0).join(" ")} ""OB`;
        const text = ["SC", "CR", "CO", "TR", '1 0 0 0 0 "" "" OB', wide, "TR", "CO", "RS", "RS", "CR", "SC", ""].join(
            "\n",
        );

        expect(readBcs(text).blocks[0]!.triggers[0]!.object.ints).toHaveLength(14);
    });

    test("reads an object's rectangle as its own field rather than as more numbers", () => {
        // Engines other than BG store a rectangle between an object's numbers and its name. Folding it into
        // `ints` would shift the identifier chain, which is read as the last five numbers before it - so it
        // gets its own slot, and a BG object (which has no such field) keeps `region` undefined.
        const withRect = '0 0 0 0 0 0 0 0 0 0 0 0 [-1.-1.-1.-1] ""OB';
        const text = [
            "SC",
            "CR",
            "CO",
            "TR",
            '1 0 0 0 0 "" "" OB',
            withRect,
            "TR",
            "CO",
            "RS",
            "RS",
            "CR",
            "SC",
            "",
        ].join("\n");

        const object = readBcs(text).blocks[0]!.triggers[0]!.object;

        expect(object.ints).toHaveLength(12);
        expect(object.region).toEqual([-1, -1, -1, -1]);
    });

    test("still refuses a field shape it does not model, rather than skipping it", () => {
        // The guard that made the case above an error has to keep working for genuinely unreadable input,
        // or a malformed line becomes a silently truncated record.
        const bad = '0 0 0 0 0 0 0 0 0 0 0 0 <nonsense> ""OB';
        const text = ["SC", "CR", "CO", "TR", '1 0 0 0 0 "" "" OB', bad, "TR", "CO", "RS", "RS", "CR", "SC", ""].join(
            "\n",
        );

        expect(() => readBcs(text)).toThrow(/Unreadable BCS fields \(line 6\)/);
    });
});

describe("readBcs - rejected input", () => {
    test("refuses a file that does not open with a script marker", () => {
        expect(() => readBcs("CR\nCO\nCO\nCR\n")).toThrow(/SC/);
    });

    test("names the marker it expected and the line it gave up on", () => {
        // A condition-response block holds a condition AND a response set; this one skips straight to its
        // own closer. The message has to say which marker was missing and where, since a reader looking at
        // 1.4 million lines of ASCII has nothing else to go on.
        expect(() => readBcs("SC\nCR\nCO\nCO\nCR\n")).toThrow(/Expected RS but found CR \(line 5\)/);
    });

    test("refuses a file that ends inside a block", () => {
        expect(() => readBcs("SC\nCR\nCO\n")).toThrow(/Unclosed/i);
    });

    test("refuses a line that is neither a marker nor a field run", () => {
        expect(() => readBcs("SC\nnonsense\nSC\n")).toThrow(/line 2/);
    });

    test("refuses a trigger with no object", () => {
        // Every trigger in the corpus carries exactly one, and its own fields ride on that object's
        // opening marker - so a trigger without one has nowhere to have put them.
        expect(() => readBcs("SC\nCR\nCO\nTR\nTR\nCO\nRS\nRS\nCR\nSC\n")).toThrow(/trigger's fields/);
    });

    test("refuses an action with no id", () => {
        expect(() => readBcs("SC\nCR\nCO\nCO\nRS\nRE\nAC\nAC\nRE\nRS\nCR\nSC\n")).toThrow(/action id/);
    });

    test("refuses a line whose marker is right but whose fields are not", () => {
        // The dangerous shape: it ends in a real marker, so a reader that only looked at the suffix would
        // take it and silently drop whatever it could not read into a number or a quoted string.
        expect(() => readBcs('SC\nCR\nCO\nTR\n16412 ?? 0OB\n0 ""OB\nTR\nCO\nRS\nRS\nCR\nSC\n')).toThrow(
            /Unreadable BCS fields \(line 5\)/,
        );
    });
});
