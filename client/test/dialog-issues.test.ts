import { describe, expect, it } from "vitest";
import { dialogIssues } from "../src/dialog-editor/webview/dialog-issues";
import type { DialogModel, DialogState } from "../../shared/dialog-model";

const st = (over: Partial<DialogState> & { id: string }): DialogState => ({ text: "", choices: [], ...over });

function model(states: DialogState[], format: DialogModel["format"] = "weidu-d"): DialogModel {
    return { format, editable: true, roots: [{ id: "d", label: "d", kind: "dialog", states }] };
}

describe("dialogIssues", () => {
    it("does NOT flag CHAIN-derived states that legitimately share an id (the x#viconia.d VISK1 case)", () => {
        // Two chains converging on the same terminal produce derived states with the same synthesized id.
        // That is a projection artifact, not a duplicate label that would break a saved .d.
        const m = model([
            st({ id: "VISK1", derivedFrom: "CHAIN" }),
            st({ id: "VISK1", derivedFrom: "CHAIN" }),
            st({ id: "VISK1_1", derivedFrom: "CHAIN" }),
            st({ id: "VISK1_1", derivedFrom: "CHAIN" }),
        ]);
        expect(dialogIssues(m)).toEqual([]);
    });

    it("flags a real duplicate label among source-authored states in one dialog", () => {
        const m = model([st({ id: "hello" }), st({ id: "hello" })]);
        expect(dialogIssues(m)).toEqual(["Duplicate state label: hello"]);
    });

    it("does not flag the same label across different dialogs (labels are unique per DLG, not globally)", () => {
        const m: DialogModel = {
            format: "weidu-d",
            editable: true,
            roots: [
                { id: "a", label: "a", kind: "dialog", states: [st({ id: "hello" })] },
                { id: "b", label: "b", kind: "dialog", states: [st({ id: "hello" })] },
            ],
        };
        expect(dialogIssues(m)).toEqual([]);
    });

    it("flags a transition to a missing state, but not one to a real (or derived) state", () => {
        const m = model([
            st({ id: "A", choices: [{ id: "A#0", text: "", target: { kind: "state", stateId: "gone" } }] }),
            st({ id: "B", choices: [{ id: "B#0", text: "", target: { kind: "state", stateId: "Deriv" } }] }),
            st({ id: "Deriv", derivedFrom: "CHAIN" }),
        ]);
        expect(dialogIssues(m)).toEqual([`A: transition points to missing state "gone"`]);
    });
});
