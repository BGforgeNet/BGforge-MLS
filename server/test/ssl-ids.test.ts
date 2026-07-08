import { describe, expect, it } from "vitest";
import { allocateNodeIds, allocateOptionIds } from "../../shared/dialog-ssl-ids";
import type { DialogModel } from "../../shared/dialog-model";

const sslModel = (): DialogModel => ({
    sourceLang: "ssl",
    editable: false,
    roots: [
        {
            id: "d",
            label: "d",
            kind: "dialog",
            states: [
                {
                    id: "Node001",
                    text: "@100",
                    faithful: true,
                    insertAnchor: { offset: 0, indent: "    " },
                    choices: [
                        // Existing option: has a callRange + an @N text ref -> untouched.
                        {
                            id: "Node001#opt0",
                            text: "@101",
                            target: { kind: "state", stateId: "Node002" },
                            callRange: { start: 1, end: 2 },
                            targetRange: { start: 1, end: 2 },
                        },
                        // New option: literal text, no callRange -> needs an id.
                        { id: "Node001#new0", text: "Brand new reply", target: { kind: "state", stateId: "Node002" } },
                    ],
                },
            ],
        },
    ],
});

describe("allocateOptionIds", () => {
    it("assigns max+1 to a new option, sets its text to @<id>, and returns the new message map", () => {
        const model = sslModel();
        const existing = { "100": "npc", "101": "old reply" };
        const newMessages = allocateOptionIds(model, existing);
        const created = model.roots[0]!.states[0]!.choices[1]!;
        expect(created.text).toBe("@102"); // max(100,101)+1
        expect(newMessages).toEqual({ "102": "Brand new reply" });
    });

    it("does not touch options that already have a callRange (existing in source)", () => {
        const model = sslModel();
        allocateOptionIds(model, { "100": "npc", "101": "old reply" });
        expect(model.roots[0]!.states[0]!.choices[0]!.text).toBe("@101");
    });

    it("allocates distinct sequential ids for multiple new options", () => {
        const model = sslModel();
        model.roots[0]!.states[0]!.choices.push({ id: "Node001#new1", text: "Another", target: { kind: "exit" } });
        const newMessages = allocateOptionIds(model, { "100": "npc" });
        expect(Object.keys(newMessages).sort()).toEqual(["101", "102"]);
    });
});

describe("allocateNodeIds", () => {
    it("allocates ids for a new node's reply and options, returning the id map and the new messages", () => {
        const model: DialogModel = {
            sourceLang: "ssl",
            editable: false,
            roots: [
                {
                    id: "d",
                    label: "d",
                    kind: "dialog",
                    states: [
                        // existing node (has procRange) -> ignored
                        { id: "Node001", text: "@100", procRange: { start: 0, end: 1 }, choices: [] },
                        // new node (no procRange) with a reply + one option
                        {
                            id: "Node050",
                            text: "New npc line",
                            choices: [{ id: "Node050#opt0", text: "New option", target: { kind: "exit" } }],
                        },
                    ],
                },
            ],
        };
        const { ids, newMessages } = allocateNodeIds(model, { "100": "old" });
        expect(ids.get("Node050")).toEqual({ reply: 101, options: { "Node050#opt0": 102 } });
        expect(newMessages).toEqual({ "101": "New npc line", "102": "New option" });
        // The node's text and option text are rewritten to their @ids (so the splice references them).
        expect(model.roots[0]!.states[1]!.text).toBe("@101");
        expect(model.roots[0]!.states[1]!.choices[0]!.text).toBe("@102");
    });
});
