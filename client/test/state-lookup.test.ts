import { describe, expect, it } from "vitest";
import { findStateInRoots } from "../src/dialog-editor/webview/state-lookup";
import type { DialogModel, DialogState } from "../../shared/dialog-model";

const st = (id: string, choices: DialogState["choices"] = []): DialogState => ({ id, text: "", choices });

function roots(...groups: Array<[string, DialogState[]]>): DialogModel["roots"] {
    return groups.map(([id, states]) => ({ id, label: id, kind: "dialog" as const, states }));
}

describe("findStateInRoots", () => {
    it("resolves a state within the ACTIVE root when the same id exists in an earlier root", () => {
        // The bug: two dialogs (roots) share a state label; the selection/edit acts on the active tab, but a
        // first-match-across-all-roots lookup returns the OTHER root's instance - so setChoiceTarget can't find
        // the choice (it lives on the active root's state) and the target never changes.
        const a = st("shared", [{ id: "shared#a", text: "", target: { kind: "exit" } }]);
        const b = st("shared", [{ id: "shared#b", text: "", target: { kind: "exit" } }]);
        const model: DialogModel = { format: "weidu-d", editable: true, roots: roots(["A", [a]], ["B", [b]]) };
        // Active tab is B: the B instance must win, so its choice ids are the editable ones.
        expect(findStateInRoots(model.roots, "B", "shared")).toBe(b);
        expect(findStateInRoots(model.roots, "A", "shared")).toBe(a);
    });

    it("falls back to other roots when the id is absent from the active root", () => {
        const a = st("only_in_a");
        const model: DialogModel = { format: "weidu-d", editable: true, roots: roots(["A", [a]], ["B", []]) };
        expect(findStateInRoots(model.roots, "B", "only_in_a")).toBe(a);
    });

    it("returns null when no root has the id", () => {
        const model: DialogModel = { format: "weidu-d", editable: true, roots: roots(["A", [st("x")]]) };
        expect(findStateInRoots(model.roots, "A", "nope")).toBeNull();
    });
});
