import { describe, expect, it } from "vitest";
import { findCallers } from "../src/dialog-editor/webview/find-callers";
import type { DialogModel, DialogState } from "../../shared/dialog-model";

const span = { start: 0, end: 1 };

function model(states: DialogState[], extra: Partial<DialogModel> = {}): DialogModel {
    return {
        sourceLang: "ssl",
        editable: false,
        roots: [{ id: "d", label: "d", kind: "dialog", states }],
        ...extra,
    };
}

describe("findCallers", () => {
    it("finds inbound OPTION targets (a choice with a callRange) that point at the node", () => {
        const m = model([
            {
                id: "Node001",
                text: "",
                choices: [
                    { id: "Node001#0", text: "@1", target: { kind: "state", stateId: "Node002" }, callRange: span },
                ],
            },
            { id: "Node002", text: "", choices: [] },
        ]);
        expect(findCallers(m, "Node002")).toEqual([{ kind: "option", fromStateId: "Node001", choiceId: "Node001#0" }]);
        expect(findCallers(m, "Node001")).toEqual([]); // nothing targets Node001
    });

    it("classifies a `call` transition (choice with callSites, no callRange) as a call, not an option", () => {
        const m = model([
            {
                id: "Node003",
                text: "",
                choices: [
                    {
                        id: "Node003#call",
                        text: "",
                        target: { kind: "state", stateId: "Node002" },
                        callSites: [{ stmtRange: span, targetRange: span, topLevel: true }],
                    },
                ],
            },
            { id: "Node002", text: "", choices: [] },
        ]);
        expect(findCallers(m, "Node002")).toEqual([{ kind: "call", fromStateId: "Node003", choiceId: "Node003#call" }]);
    });

    it("reports a talk_p_proc entry, and a force_dialog_start entry as an external entry", () => {
        const m = model(
            [
                { id: "Node002", text: "", choices: [] },
                { id: "Node004", text: "", choices: [] },
            ],
            {
                entryIds: ["Node002", "Node004"],
                entryCalls: [{ name: "Node002", stmtRange: span, targetRange: span, topLevel: true }],
            },
        );
        expect(findCallers(m, "Node002")).toEqual([{ kind: "entry" }]);
        // Node004 is in entryIds but has no talk_p_proc call -> reached by force_dialog_start/start_dialog_at_node.
        expect(findCallers(m, "Node004")).toEqual([{ kind: "external-entry" }]);
    });

    it("lists entry first, then inbound refs, and covers a node reached several ways", () => {
        const m = model(
            [
                { id: "Node002", text: "", choices: [] },
                {
                    id: "Node001",
                    text: "",
                    choices: [
                        { id: "Node001#0", text: "@1", target: { kind: "state", stateId: "Node002" }, callRange: span },
                    ],
                },
            ],
            {
                entryIds: ["Node002"],
                entryCalls: [{ name: "Node002", stmtRange: span, targetRange: span, topLevel: true }],
            },
        );
        expect(findCallers(m, "Node002")).toEqual([
            { kind: "entry" },
            { kind: "option", fromStateId: "Node001", choiceId: "Node001#0" },
        ]);
    });
});
