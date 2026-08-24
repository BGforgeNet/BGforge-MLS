import { describe, expect, it } from "vitest";
import { modelFromDlg, type DlgModelInput } from "../../shared/dialog-model-dlg";
import { dlgTextEdits } from "../../shared/dialog-dlg-edit";
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
        expect(dlgTextEdits(model(), model())).toEqual([]);
    });

    it("reports a changed state line as that state's index", () => {
        const after = edited((m) => {
            m.roots[0]!.states[1]!.text = "@99";
        });
        expect(dlgTextEdits(model(), after)).toEqual([{ stateIndex: 1, strref: 99 }]);
    });

    it("reports a changed reply as its position within the state", () => {
        const after = edited((m) => {
            m.roots[0]!.states[0]!.choices[1]!.text = "@98";
        });
        expect(dlgTextEdits(model(), after)).toEqual([{ stateIndex: 0, choiceIndex: 1, strref: 98 }]);
    });

    it("reports every change at once, states before their replies", () => {
        const after = edited((m) => {
            m.roots[0]!.states[0]!.text = "@1";
            m.roots[0]!.states[0]!.choices[0]!.text = "@2";
            m.roots[0]!.states[1]!.text = "@3";
        });
        expect(dlgTextEdits(model(), after)).toEqual([
            { stateIndex: 0, strref: 1 },
            { stateIndex: 0, choiceIndex: 0, strref: 2 },
            { stateIndex: 1, strref: 3 },
        ]);
    });

    it("ignores a change that leaves the reference where it was", () => {
        const after = edited((m) => {
            m.roots[0]!.states[0]!.text = "@10";
        });
        expect(dlgTextEdits(model(), after)).toEqual([]);
    });

    // A compiled dialog can only point at a string the game's table already holds; storing new prose would
    // mean writing dialog.tlk, which this path does not do.
    it("refuses text that is not a string reference", () => {
        const after = edited((m) => {
            m.roots[0]!.states[0]!.text = "Hello there";
        });
        expect(() => dlgTextEdits(model(), after)).toThrow(/reference/i);
    });

    it("refuses a structural change, which it cannot express", () => {
        const removed = edited((m) => {
            m.roots[0]!.states.pop();
        });
        expect(() => dlgTextEdits(model(), removed)).toThrow(/structure/i);

        const extraChoice = edited((m) => {
            m.roots[0]!.states[1]!.choices.push({ id: "1#1", text: "@5", target: { kind: "exit" } });
        });
        expect(() => dlgTextEdits(model(), extraChoice)).toThrow(/structure/i);
    });

    it("refuses a model that is not from a compiled dialog", () => {
        const wrong = edited((m) => {
            m.sourceLang = "d";
        });
        expect(() => dlgTextEdits(model(), wrong)).toThrow(/dlg/i);
    });
});
