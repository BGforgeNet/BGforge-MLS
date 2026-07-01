import { describe, expect, it } from "vitest";
import { computeDialogSourceEdit } from "../src/dialog-editor/dialog-source-edit";
import type { DialogModel, DialogState } from "../../shared/dialog-model";

// A minimal WeiDU D document with two states; retargeting the transition changes the source text.
const D_SRC = [
    "BEGIN test",
    "IF ~~ THEN BEGIN hello",
    "  SAY @0",
    "  IF ~~ THEN GOTO more",
    "END",
    "IF ~~ THEN BEGIN more",
    "  SAY @1",
    "  IF ~~ THEN EXIT",
    "END",
].join("\n");

// Hand-built DialogModel rather than parsed: client/test has no D-parser fixture helper (parsing
// lives in server/src, out of bounds for a client-side unit test), and client/test/dialog-tree-d.test.ts
// establishes the project's pattern of hand-building the parser's output shape directly for this kind
// of test. computeDialogSourceEdit only needs a DialogModel with real sourceRange offsets into D_SRC -
// it does not re-test the D parser itself, only the splice/id-allocation wrapper.
//
// Each state's sourceRange is derived from D_SRC via indexOf (not hand-counted), so it stays correct
// if the fixture text above is ever edited.
function stateRange(startNeedle: string): { start: number; end: number } {
    const start = D_SRC.indexOf(startNeedle);
    if (start === -1) throw new Error(`fixture text does not contain "${startNeedle}"`);
    const end = D_SRC.indexOf("END", start) + "END".length;
    return { start, end };
}

// Builds a fresh DialogModel on every call so a test mutating "edited" never affects "original".
function buildModel(): DialogModel {
    const hello: DialogState = {
        id: "hello",
        text: "@0",
        trigger: "",
        choices: [{ id: "hello_0", target: { kind: "state", stateId: "more" }, condition: "" }],
        sourceRange: stateRange("IF ~~ THEN BEGIN hello"),
    };
    const more: DialogState = {
        id: "more",
        text: "@1",
        trigger: "",
        choices: [{ id: "more_0", target: { kind: "exit" }, condition: "" }],
        sourceRange: stateRange("IF ~~ THEN BEGIN more"),
    };
    return {
        format: "weidu-d",
        editable: true,
        roots: [{ id: "test", label: "test", kind: "dialog", states: [hello, more] }],
        messages: {},
    };
}

describe("computeDialogSourceEdit", () => {
    it("returns null newText when the model is unchanged", () => {
        const model = buildModel();
        const result = computeDialogSourceEdit(D_SRC, model, model);
        expect(result.newText).toBeNull();
    });

    it("returns spliced text when a transition is retargeted", () => {
        const original = buildModel();
        const edited = buildModel();
        // Retarget hello's only transition from `more` to EXIT.
        const hello = edited.roots.flatMap((r) => r.states).find((s) => s.id === "hello")!;
        hello.choices[0]!.target = { kind: "exit" };
        const result = computeDialogSourceEdit(D_SRC, edited, original);
        expect(result.newText).not.toBeNull();
        expect(result.newText).toContain("EXIT");
    });
});
