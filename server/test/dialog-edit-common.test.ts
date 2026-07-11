import { describe, expect, it } from "vitest";
import {
    allChoices,
    allStates,
    bareMsgId,
    lineIndentAt,
    nextIdSeed,
    removeLineSplice,
} from "../../shared/dialog-edit-common";
import type { DialogChoice, DialogModel, DialogState } from "../../shared/dialog-model";

// Direct edge-case coverage for the shared writer/id-allocator helpers. Four language writers depend on this
// module, so a regression here surfaces as a confusing failure three layers up; these pin the boundaries
// (empty input, non-numeric keys, buffer-start indent, CRLF vs LF removal) each writer relies on.

const st = (id: string, choices: DialogChoice[] = []): DialogState => ({ id, speaker: "NPC", text: "", choices });
const model = (states: DialogState[]): DialogModel => ({
    sourceLang: "ssl",
    editable: true,
    roots: [{ id: "r", label: "r", kind: "dialog", states }],
});

describe("allStates / allChoices", () => {
    it("flattens states across roots and choices across states, in order", () => {
        const m: DialogModel = {
            sourceLang: "ssl",
            editable: true,
            roots: [
                { id: "r1", label: "r1", kind: "dialog", states: [st("A", [{ id: "A#0", target: { kind: "exit" } }])] },
                {
                    id: "r2",
                    label: "r2",
                    kind: "dialog",
                    states: [st("B"), st("C", [{ id: "C#0", target: { kind: "exit" } }])],
                },
            ],
        };
        expect(allStates(m).map((s) => s.id)).toEqual(["A", "B", "C"]);
        expect(allChoices(m).map((c) => c.id)).toEqual(["A#0", "C#0"]);
    });

    it("returns empty arrays for a model with no states", () => {
        expect(allStates(model([]))).toEqual([]);
        expect(allChoices(model([]))).toEqual([]);
    });
});

describe("bareMsgId", () => {
    it("parses a bare @N, trimming surrounding whitespace", () => {
        expect(bareMsgId("@5")).toBe(5);
        expect(bareMsgId("  @42  ")).toBe(42);
    });
    it("rejects non-@N text, a bare number, a negative, and undefined", () => {
        expect(bareMsgId("hello")).toBeUndefined();
        expect(bareMsgId("@x")).toBeUndefined();
        expect(bareMsgId("5")).toBeUndefined(); // no leading @
        expect(bareMsgId("@-5")).toBeUndefined(); // \d+ excludes the sign
        expect(bareMsgId("@5 @6")).toBeUndefined(); // not a single bare ref
        expect(bareMsgId(undefined)).toBeUndefined();
        expect(bareMsgId("")).toBeUndefined();
    });
});

describe("nextIdSeed", () => {
    it("is 1 for an empty set (nothing allocated yet)", () => {
        expect(nextIdSeed({})).toBe(1);
    });
    it("is max numeric key + 1, ignoring non-numeric keys", () => {
        expect(nextIdSeed({ "3": "a", "7": "b", "5": "c" })).toBe(8);
        expect(nextIdSeed({ label: "a", "2": "b" })).toBe(3);
    });
    it("is 1 when no key is numeric", () => {
        expect(nextIdSeed({ foo: "a", bar: "b" })).toBe(1);
    });
});

describe("lineIndentAt", () => {
    it("returns the leading whitespace of the line containing the offset", () => {
        const text = "abc\n    def";
        expect(lineIndentAt(text, text.indexOf("def"))).toBe("    ");
    });
    it("returns empty string on the first line (buffer start, no preceding newline)", () => {
        expect(lineIndentAt("abc\n  def", 1)).toBe("");
    });
    it("captures a tab indent and stops at the first non-whitespace", () => {
        const text = "x\n\t\tY";
        expect(lineIndentAt(text, text.indexOf("Y"))).toBe("\t\t");
    });
});

describe("removeLineSplice", () => {
    it("consumes the leading indent and a trailing LF so no blank line remains", () => {
        const text = "  X\n";
        expect(removeLineSplice(text, { start: 2, end: 3 })).toEqual({ start: 0, end: 4, replacement: "" });
    });
    it("consumes a trailing CRLF as one unit", () => {
        const text = "  X\r\n";
        expect(removeLineSplice(text, { start: 2, end: 3 })).toEqual({ start: 0, end: 5, replacement: "" });
    });
    it("leaves a trailing non-newline char untouched (statement mid-line, EOF)", () => {
        const text = "X;more";
        expect(removeLineSplice(text, { start: 0, end: 1 })).toEqual({ start: 0, end: 1, replacement: "" });
    });
});
