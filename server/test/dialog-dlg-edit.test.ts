import { describe, expect, it } from "vitest";
import { modelFromDlg, type DlgModelInput } from "../../shared/dialog-model-dlg";
import { dlgAddress, dlgTextEdits } from "../../shared/dialog-dlg-edit";
import type { DialogModel } from "../../shared/dialog-model";

/** Two states: the first says @10 and offers two replies, the second says @11 and ends. */
function sample(): DlgModelInput {
    return {
        resref: "TEST",
        states: [
            { text: 10, firstTransition: 0, transitionCount: 2, triggerIndex: -1 },
            { text: 11, firstTransition: 2, transitionCount: 1, triggerIndex: -1 },
        ],
        transitions: [
            {
                text: 20,
                journalText: 0,
                triggerIndex: -1,
                actionIndex: -1,
                nextDialog: "TEST",
                nextState: 1,
                hasText: true,
                hasTrigger: false,
                hasAction: false,
                hasJournalEntry: false,
                terminatesDialog: false,
            },
            {
                text: 21,
                journalText: 0,
                triggerIndex: -1,
                actionIndex: -1,
                nextDialog: "",
                nextState: 0,
                hasText: true,
                hasTrigger: false,
                hasAction: false,
                hasJournalEntry: false,
                terminatesDialog: true,
            },
            {
                text: 22,
                journalText: 0,
                triggerIndex: -1,
                actionIndex: -1,
                nextDialog: "",
                nextState: 0,
                hasText: true,
                hasTrigger: false,
                hasAction: false,
                hasJournalEntry: false,
                terminatesDialog: true,
            },
        ],
        stateTriggers: [],
        transitionTriggers: [],
        actions: [],
    };
}

const model = (): DialogModel => modelFromDlg(sample());

/** Deep-clone so an edit to the copy cannot reach through into the original. */
function edited(mutate: (m: DialogModel) => void): DialogModel {
    const copy = structuredClone(model()) as DialogModel;
    mutate(copy);
    return copy;
}

describe("dlgTextEdits", () => {
    it("reports nothing when nothing changed", () => {
        expect(dlgTextEdits(model(), model(), "TEST")).toEqual([]);
    });

    it("reports a changed state line as that state's index", () => {
        const after = edited((m) => {
            m.roots[0]!.states[1]!.text = "@99";
        });
        expect(dlgTextEdits(model(), after, "TEST")).toEqual([{ stateIndex: 1, strref: 99 }]);
    });

    it("reports a changed reply as its position within the state", () => {
        const after = edited((m) => {
            m.roots[0]!.states[0]!.choices[1]!.text = "@98";
        });
        expect(dlgTextEdits(model(), after, "TEST")).toEqual([{ stateIndex: 0, choiceIndex: 1, strref: 98 }]);
    });

    it("reports every change at once, states before their replies", () => {
        const after = edited((m) => {
            m.roots[0]!.states[0]!.text = "@1";
            m.roots[0]!.states[0]!.choices[0]!.text = "@2";
            m.roots[0]!.states[1]!.text = "@3";
        });
        expect(dlgTextEdits(model(), after, "TEST")).toEqual([
            { stateIndex: 0, strref: 1 },
            { stateIndex: 0, choiceIndex: 0, strref: 2 },
            { stateIndex: 1, strref: 3 },
        ]);
    });

    it("ignores a change that leaves the reference where it was", () => {
        const after = edited((m) => {
            m.roots[0]!.states[0]!.text = "@10";
        });
        expect(dlgTextEdits(model(), after, "TEST")).toEqual([]);
    });

    // A compiled dialog can only point at a string the game's table already holds; storing new prose would
    // mean writing dialog.tlk, which this path does not do.
    it("refuses text that is not a string reference", () => {
        const after = edited((m) => {
            m.roots[0]!.states[0]!.text = "Hello there";
        });
        expect(() => dlgTextEdits(model(), after, "TEST")).toThrow(/reference/i);
    });

    it("refuses a structural change, which it cannot express", () => {
        const removed = edited((m) => {
            m.roots[0]!.states.pop();
        });
        expect(() => dlgTextEdits(model(), removed, "TEST")).toThrow(/structure/i);

        const extraChoice = edited((m) => {
            m.roots[0]!.states[1]!.choices.push({ id: "1#1", text: "@5", target: { kind: "exit" } });
        });
        expect(() => dlgTextEdits(model(), extraChoice, "TEST")).toThrow(/structure/i);
    });

    // Once the tree can show states pulled in from other dialogs, the flattened state list is no longer this
    // file's state table: position stops meaning index, and a state that is not ours must not be written here
    // at all. Both are why the differ takes the owning resref and reads `dlgIndex` rather than counting.
    it("addresses a state by its file index, not by where it sits in the flattened list", () => {
        const withExternal = (m: DialogModel): void => {
            m.roots.unshift({
                id: "dialog:OTHER",
                label: "OTHER",
                kind: "dialog",
                states: [
                    { id: "OTHER:0", dlgIndex: 0, dlgResref: "OTHER", text: "@70", choices: [] },
                    { id: "OTHER:1", dlgIndex: 1, dlgResref: "OTHER", text: "@71", choices: [] },
                ],
            });
        };
        const before = edited(withExternal);
        const after = edited((m) => {
            withExternal(m);
            // roots[1] is ours; its second state is file index 1, though it is fourth in the flattened list.
            m.roots[1]!.states[1]!.text = "@99";
        });

        expect(dlgTextEdits(before, after, "TEST")).toEqual([{ stateIndex: 1, strref: 99 }]);
    });

    it("ignores a change to a state belonging to another dialog", () => {
        const withExternal = (m: DialogModel): void => {
            m.roots.push({
                id: "dialog:OTHER",
                label: "OTHER",
                kind: "dialog",
                states: [{ id: "OTHER:0", dlgIndex: 0, dlgResref: "OTHER", text: "@70", choices: [] }],
            });
        };
        const before = edited(withExternal);
        const after = edited((m) => {
            withExternal(m);
            m.roots[1]!.states[0]!.text = "@88";
        });

        // Writing it here would put another file's edit into this one's state table.
        expect(dlgTextEdits(before, after, "TEST")).toEqual([]);
    });

    it("refuses a model that is not from a compiled dialog", () => {
        const wrong = edited((m) => {
            m.sourceLang = "d";
        });
        expect(() => dlgTextEdits(model(), wrong, "TEST")).toThrow(/dlg/i);
    });
});

describe("dlgAddress", () => {
    const state = () => modelFromDlg(sample()).roots[0]!.states[0]!;

    it("addresses a state's own line by its file index", () => {
        expect(dlgAddress(state(), null)).toEqual({ stateIndex: 0 });
    });

    it("addresses a reply by its position within the state", () => {
        const s = state();
        expect(dlgAddress(s, s.choices[1]!.id)).toEqual({ stateIndex: 0, choiceIndex: 1 });
    });

    it("refuses a state the file does not hold, rather than addressing state 0", () => {
        // A state the user just added has no record yet; `Number(id)` on a dialog-qualified id would be NaN,
        // and NaN silently coerces to 0 in the writer - so this must be a refusal, not a number.
        expect(dlgAddress({ id: "TEST:0", text: "@1", choices: [] }, null)).toBeNull();
    });

    it("refuses a reply id the state does not have", () => {
        expect(dlgAddress(state(), "nope")).toBeNull();
    });
});
