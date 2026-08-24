import { describe, expect, it } from "vitest";
import { buildDlg, readDlg, type DlgBuildInput } from "@bgforge/binary";
import { writeDlgFromModel } from "../src/dialog-editor/dlg-write";
import { modelFromDlg } from "../../shared/dialog-model-dlg";
import type { DialogModel } from "../../shared/dialog-model";

/** Resrefs are fixed-width and NUL-padded on the wire, which is how the reader hands them back. */
const resref = (name: string) => name.padEnd(8, "\u0000");

/**
 * Two states. The first says @10 and offers two replies - the second of which carries a journal entry, a
 * trigger and an action, none of which the model represents; they are what a rewrite must not lose.
 */
function sample(): DlgBuildInput {
    return {
        states: [
            { text: 10, firstTransition: 0, transitionCount: 2, triggerIndex: 0 },
            { text: 11, firstTransition: 2, transitionCount: 1, triggerIndex: -1 },
        ],
        transitions: [
            {
                flags: ["text"],
                text: 20,
                journalText: -1,
                triggerIndex: -1,
                actionIndex: -1,
                nextDialog: resref("TEST"),
                nextState: 1,
            },
            {
                flags: ["text", "journalEntry", "trigger", "action", "terminatesDialog"],
                text: 21,
                journalText: 500,
                triggerIndex: 0,
                actionIndex: 0,
                nextDialog: resref(""),
                nextState: 0,
            },
            {
                flags: ["terminatesDialog"],
                text: -1,
                journalText: -1,
                triggerIndex: -1,
                actionIndex: -1,
                nextDialog: resref(""),
                nextState: 0,
            },
        ],
        stateTriggers: ['Global("x","GLOBAL",1)'],
        transitionTriggers: ['Global("y","GLOBAL",2)'],
        actions: ['SetGlobal("z","GLOBAL",3)'],
    };
}

const original = () => buildDlg(sample());

/** The model a freshly-opened `sample()` produces, which edits below mutate a clone of. */
function sampleModel(): DialogModel {
    return modelFromDlg({ ...readDlg(original()), resref: "TEST" });
}

function editedModel(mutate: (m: DialogModel) => void): DialogModel {
    const copy = structuredClone(sampleModel()) as DialogModel;
    mutate(copy);
    return copy;
}

const statesOf = (m: DialogModel) => m.roots[0]!.states;

describe("writeDlgFromModel", () => {
    it("reproduces the file byte for byte when nothing changed", () => {
        expect(writeDlgFromModel(original(), sampleModel(), "TEST")).toEqual(original());
    });

    it("shrinks a state's reply window when a reply is removed, and shifts the states after it", () => {
        const after = editedModel((m) => {
            statesOf(m)[0]!.choices.splice(0, 1);
        });
        const dlg = readDlg(writeDlgFromModel(original(), after, "TEST"));

        expect(dlg.states[0]!.transitionCount).toBe(1);
        // State 1's single reply used to start at 2; with one gone above it, it starts at 1.
        expect(dlg.states[1]!.firstTransition).toBe(1);
        expect(dlg.states[1]!.transitionCount).toBe(1);
        expect(dlg.transitions).toHaveLength(2);
        // The surviving reply is the one that was second - carrying its journal entry with it.
        expect(dlg.transitions[0]!.journalText).toBe(500);
    });

    it("appends a new state after the existing ones, leaving their indices alone", () => {
        const after = editedModel((m) => {
            statesOf(m).push({ id: "new", dlgResref: "TEST", text: "@42", choices: [] });
        });
        const dlg = readDlg(writeDlgFromModel(original(), after, "TEST"));

        expect(dlg.states).toHaveLength(3);
        expect(dlg.states[2]!.text).toBe(42);
        expect(dlg.states[0]!.text).toBe(10);
        expect(dlg.states[1]!.text).toBe(11);
    });

    it("extends a state's window when a reply is added, without disturbing its neighbours", () => {
        const after = editedModel((m) => {
            statesOf(m)[0]!.choices.push({ id: "0#2", text: "@77", target: { kind: "exit" } });
        });
        const dlg = readDlg(writeDlgFromModel(original(), after, "TEST"));

        expect(dlg.states[0]!.transitionCount).toBe(3);
        expect(dlg.transitions[2]!.text).toBe(77);
        expect(dlg.transitions[2]!.terminatesDialog).toBe(true);
        expect(dlg.states[1]!.firstTransition).toBe(3);
    });

    it("rewrites a reply's target when it is pointed at another state", () => {
        const after = editedModel((m) => {
            // Reply 0 of state 0 goes to state 1; send it to state 0 instead.
            statesOf(m)[0]!.choices[0]!.target = { kind: "state", stateId: statesOf(m)[0]!.id };
        });
        const dlg = readDlg(writeDlgFromModel(original(), after, "TEST"));

        expect(dlg.transitions[0]!.nextState).toBe(0);
        expect(dlg.transitions[0]!.terminatesDialog).toBe(false);
    });

    it("keeps the fields the model never carries", () => {
        const after = editedModel((m) => {
            statesOf(m)[0]!.text = "@1";
        });
        const dlg = readDlg(writeDlgFromModel(original(), after, "TEST"));

        expect(dlg.transitions[1]!.journalText).toBe(500);
        expect(dlg.transitions[1]!.hasJournalEntry).toBe(true);
        expect(dlg.states[0]!.triggerIndex).toBe(0);
        expect(dlg.stateTriggers).toEqual(sample().stateTriggers);
    });

    // Removing a state is the one structural change that renumbers, and it is what detaching exists to
    // avoid. A model that has simply lost one must not quietly write a shorter dialog.
    it("refuses to write a file that has lost a state", () => {
        const after = editedModel((m) => {
            statesOf(m).pop();
        });
        expect(() => writeDlgFromModel(original(), after, "TEST")).toThrow(/missing|lost/i);
    });

    it("refuses to write a file with no states at all", () => {
        const after = editedModel((m) => {
            m.roots = [];
        });
        expect(() => writeDlgFromModel(original(), after, "TEST")).toThrow(/missing|lost/i);
    });

    // The whole safety story of this phase is that an existing state never moves. Rather than trust the
    // emission order to keep that true, the writer checks it and refuses.
    it("refuses to write a file in which an existing state would change index", () => {
        const after = editedModel((m) => {
            statesOf(m).reverse();
        });
        expect(() => writeDlgFromModel(original(), after, "TEST")).toThrow(/index/i);
    });
});

/**
 * A file whose two states carry the SAME trigger text at two different table indices - which real files do,
 * since the writer never dedups. Looking an entry up by text alone would collapse both onto the first.
 */
function duplicateTriggers(): DlgBuildInput {
    return {
        states: [
            { text: 10, firstTransition: 0, transitionCount: 0, triggerIndex: 0 },
            { text: 11, firstTransition: 0, transitionCount: 0, triggerIndex: 1 },
        ],
        transitions: [],
        stateTriggers: ['Global("x","GLOBAL",1)', 'Global("x","GLOBAL",1)'],
        transitionTriggers: [],
        actions: [],
    };
}

describe("writeDlgFromModel, table entries", () => {
    it("keeps a state pointing at its own table entry when another holds the same text", () => {
        const bytes = buildDlg(duplicateTriggers());
        const model = modelFromDlg({ ...readDlg(bytes), resref: "DUP" });

        const dlg = readDlg(writeDlgFromModel(bytes, model, "DUP"));

        expect(dlg.states[1]!.triggerIndex).toBe(1);
        expect(writeDlgFromModel(bytes, model, "DUP")).toEqual(bytes);
    });
});
