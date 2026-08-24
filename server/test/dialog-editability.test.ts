import { describe, expect, it } from "vitest";
import { nodeEditable, nodeDeletable, nodeRenamable } from "../../shared/dialog-editability";
import type { DialogModel, DialogState, SourceLang } from "../../shared/dialog-model";

/** Minimal model wrapping one state under one dialog root; `editable` mirrors what each family's adapter sets. */
function model(sourceLang: SourceLang, node: DialogState, editable = sourceLang === "d"): DialogModel {
    return {
        sourceLang,
        editable,
        roots: [{ id: "r", label: "r", kind: "dialog", states: [node] }],
        messages: {},
    };
}

function state(partial: Partial<DialogState>): DialogState {
    return { id: "Node001", text: "@1", choices: [], ...partial };
}

/** A parsed SSL/TSSL node carries a `procRange`; without one it would classify as a locally-new node (editable),
 *  so tests of read-only *parsed* nodes must set it or they exercise the wrong branch (isLocalNewSSLNode). */
function sslState(partial: Partial<DialogState>): DialogState {
    return state({ procRange: { start: 0, end: 10 }, ...partial });
}

describe("nodeEditable - one predicate across families (no field-vs-structural split)", () => {
    it("fallout-ssl: a faithful flat node is editable; a non-faithful one is not", () => {
        expect(nodeEditable(model("ssl", sslState({ faithful: true })), sslState({ faithful: true }))).toBe(true);
        expect(nodeEditable(model("ssl", sslState({ faithful: false })), sslState({ faithful: false }))).toBe(false);
        // A parsed node with neither faithful nor bundleFaithful (a structured/approximate node) is read-only.
        expect(nodeEditable(model("ssl", sslState({})), sslState({}))).toBe(false);
    });

    it("fallout-ssl: a single-level if/else bundle node is editable", () => {
        const b = sslState({ bundleFaithful: true });
        expect(nodeEditable(model("tssl", b), b)).toBe(true);
    });

    it("fallout-ssl: a locally-new node (no procRange yet) is editable before its first save", () => {
        expect(nodeEditable(model("ssl", state({})), state({}))).toBe(true);
    });

    it("weidu-d: a D state is editable; a TD state is editable unless the parser flagged it unfaithful", () => {
        // D (mature parser, faithful unset) and a plain TD state are both editable.
        expect(nodeEditable(model("d", state({})), state({}))).toBe(true);
        expect(nodeEditable(model("td", state({}), false), state({}))).toBe(true);
        // The B-tier gate: a TD state the parser marked unfaithful (body conditional it can't round-trip) is
        // read-only, so an edit can never silently drop the else / inner condition.
        expect(nodeEditable(model("td", state({ faithful: false }), false), state({ faithful: false }))).toBe(false);
    });

    it("a derived (CHAIN/INTERJECT) state is never editable, in any family", () => {
        expect(nodeEditable(model("d", state({ derivedFrom: "CHAIN" })), state({ derivedFrom: "CHAIN" }))).toBe(false);
        expect(
            nodeEditable(
                model("ssl", state({ faithful: true, derivedFrom: "INTERJECT" })),
                state({ faithful: true, derivedFrom: "INTERJECT" }),
            ),
        ).toBe(false);
    });

    it("a null state is not editable", () => {
        expect(nodeEditable(model("d", state({})), null)).toBe(false);
    });
});

describe("nodeDeletable - editable AND every inbound reference can be cleaned up", () => {
    it("a faithful SSL node with no inbound references is deletable", () => {
        const s = state({ id: "Node003", faithful: true });
        expect(nodeDeletable(model("ssl", s), s)).toBe(true);
    });

    it("a read-only node is not deletable even when nothing references it", () => {
        const s = sslState({ id: "Node003", faithful: false });
        expect(nodeDeletable(model("ssl", s), s)).toBe(false);
    });

    it("an unfaithful TD node is not deletable", () => {
        const s = state({ id: "s0", faithful: false });
        expect(nodeDeletable(model("td", s, false), s)).toBe(false);
    });
});

describe("dlg - a compiled dialog's states are editable, but its numbering is not the user's", () => {
    const dlgState = (partial: Partial<DialogState> = {}) =>
        state({ id: "TEST:0", dlgIndex: 0, dlgResref: "TEST", ...partial });

    it("a state is editable: its replies can be added, removed and retargeted", () => {
        expect(nodeEditable(model("dlg", dlgState()), dlgState())).toBe(true);
    });

    it("a state cannot be renamed - its number is its position, not a label the user chooses", () => {
        expect(nodeRenamable(model("dlg", dlgState()), dlgState())).toBe(false);
        // Every other family names its states, so renaming stays available there.
        expect(nodeRenamable(model("d", state({})), state({}))).toBe(true);
    });

    it("a state cannot be deleted - removing one renumbers every state above it", () => {
        expect(nodeDeletable(model("dlg", dlgState()), dlgState())).toBe(false);
    });

    it("a state the user just added is editable before it has an index", () => {
        expect(nodeEditable(model("dlg", state({ id: "new" })), state({ id: "new" }))).toBe(true);
    });
});
