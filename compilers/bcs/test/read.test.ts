import { describe, expect, test } from "vitest";
import { readBcs } from "@bgforge/bcs";

/**
 * A BCS is plain ASCII: nested two-letter block markers with numeric and quoted fields between them. The
 * reader is deliberately name-agnostic - it reads the numbers a script stores and never resolves one to an
 * ACTION.IDS or TRIGGER.IDS name, because which table applies depends on the install rather than the file.
 *
 * Every shape below was measured over 4939 non-empty BCS files from a stock BG:EE plus BG2:ToB pair. The
 * nesting is rigid: SC holds condition-response blocks, each holds exactly one condition and one response
 * set, a trigger holds exactly one object and an action exactly three. Field ARITY is not: objects carry 12,
 * 13 or 14 numbers depending on the engine, and triggers and actions carry between two and eight. So the
 * records hold their numbers as a list rather than as named fields - naming them is a later layer's job,
 * and one that needs to know the engine.
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

describe("readBcs - engine-dependent field counts", () => {
    // An object carries 12 numbers on BG2, 13 or 14 elsewhere - PST adds a team and a faction, and other
    // engines differ again. A reader that pinned the count would read most of one install and truncate the
    // rest, so the count is whatever the record holds. Both wider forms occur in a stock BG:EE.
    test.each([12, 13, 14])("reads an object carrying %i numbers", (arity) => {
        const object = `${Array.from({ length: arity }, () => 0).join(" ")} ""OB`;
        const text = ["SC", "CR", "CO", "TR", "16412 0OB", object, "TR", "CO", "RS", "RS", "CR", "SC", ""].join("\n");

        expect(readBcs(text).blocks[0]!.triggers[0]!.object.ints).toHaveLength(arity);
    });

    test("reads a trigger carrying more numbers than the common form", () => {
        const text = [
            "SC",
            "CR",
            "CO",
            "TR",
            '16399 0 0 0 0 0 0 "a" "b" OB',
            '0 0 0 0 0 0 0 0 0 0 0 0 ""OB',
            "TR",
            "CO",
            "RS",
            "RS",
            "CR",
            "SC",
            "",
        ].join("\n");

        expect(readBcs(text).blocks[0]!.triggers[0]!.ints).toHaveLength(7);
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
