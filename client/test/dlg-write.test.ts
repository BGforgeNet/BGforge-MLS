import { describe, expect, it } from "vitest";
import { buildDlg, readDlg, type DlgBuildInput } from "@bgforge/binary";
import { writeDlgFromModel } from "../src/dialog-editor/dlg-write";
import { modelFromDlg, modelFromDlgs, resrefName } from "../../shared/dialog-model-dlg";
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

describe("writeDlgFromModel, a tree holding more than one dialog", () => {
    /** What the tree looks like once the neighbours a conversation hands off to are loaded alongside it. */
    function withNeighbour(): DialogModel {
        return modelFromDlgs({ ...readDlg(original()), resref: "TEST" }, [
            { dlg: { ...readDlg(original()), resref: "OTHER" }, include: [0, 1] },
        ]);
    }

    it("writes only the states of the file it was asked for", () => {
        const dlg = readDlg(writeDlgFromModel(original(), withNeighbour(), "TEST"));

        expect(dlg.states).toHaveLength(2);
    });

    it("leaves the neighbour's states out byte for byte, so loading context is not an edit", () => {
        expect(writeDlgFromModel(original(), withNeighbour(), "TEST")).toEqual(original());
    });

    it("finds its own states when the file name is not spelled in caps", () => {
        // Resrefs are case-insensitive in the game's own resource lookup, and a file on disk may be named
        // either way; the model uppercases, so a raw file name would otherwise match nothing at all.
        expect(writeDlgFromModel(original(), sampleModel(), "test")).toEqual(original());
    });
});

describe("writeDlgFromModel, what it refuses and what it appends", () => {
    it("refuses a line that is not a game string reference, rather than storing a number it invented", () => {
        // A compiled dialog has nowhere to put prose - the record holds a number into the game's text.
        const after = sampleModel();
        after.roots[0]!.states[0]!.text = "Hello, sailor!";

        expect(() => writeDlgFromModel(original(), after, "TEST")).toThrow(/string reference/i);
    });

    it("refuses a reply whose text is not a string reference either", () => {
        const after = sampleModel();
        after.roots[0]!.states[0]!.choices[0]!.text = "Typed in by hand";

        expect(() => writeDlgFromModel(original(), after, "TEST")).toThrow(/reply/i);
    });

    it("appends a new trigger to the table rather than renumbering the entries above it", () => {
        const after = sampleModel();
        after.roots[0]!.states[0]!.trigger = 'Global("new","GLOBAL",1)';

        const dlg = readDlg(writeDlgFromModel(original(), after, "TEST"));

        expect(dlg.stateTriggers).toEqual(['Global("x","GLOBAL",1)', 'Global("new","GLOBAL",1)']);
        expect(dlg.states[0]!.triggerIndex).toBe(1);
    });

    it("points a second user of one text at the entry that already holds it", () => {
        const after = sampleModel();
        // State 1 takes the trigger state 0 already carries; the table must not gain a duplicate.
        after.roots[0]!.states[1]!.trigger = 'Global("x","GLOBAL",1)';

        const dlg = readDlg(writeDlgFromModel(original(), after, "TEST"));

        expect(dlg.stateTriggers).toEqual(['Global("x","GLOBAL",1)']);
        expect(dlg.states[1]!.triggerIndex).toBe(0);
    });

    it("stores a reply pointing at a dialog the tree does not hold", () => {
        const after = sampleModel();
        after.roots[0]!.states[0]!.choices[0]!.target = { kind: "external", label: "OTHER:7", resolved: false };

        const dlg = readDlg(writeDlgFromModel(original(), after, "TEST"));

        expect(resrefName(dlg.transitions[0]!.nextDialog)).toBe("OTHER");
        expect(dlg.transitions[0]!.nextState).toBe(7);
        expect(dlg.transitions[0]!.terminatesDialog).toBe(false);
    });

    it("refuses an external target that does not name a dialog and a state", () => {
        // Every other family's external label is free-form prose (a D `EXTERN` name, an SSL call). There is
        // no field pair on the wire for that, so it is refused rather than stored as a guess.
        const after = sampleModel();
        after.roots[0]!.states[0]!.choices[0]!.target = { kind: "external", label: "somewhere else", resolved: false };

        expect(() => writeDlgFromModel(original(), after, "TEST")).toThrow(/cannot store the target/i);
    });

    it("refuses a reply pointing at a state of this dialog that is not there", () => {
        const after = sampleModel();
        after.roots[0]!.states[0]!.choices[0]!.target = { kind: "state", stateId: "TEST:9" };

        expect(() => writeDlgFromModel(original(), after, "TEST")).toThrow(/no state/i);
    });
});

/**
 * The trigger, condition and action fields are text a DLG stores in its own tables. The editor kept them
 * locked, so nothing exercised the save path for an edited one - these cover it now that it is reachable.
 */
describe("writeDlgFromModel (edited trigger, condition and action)", () => {
    it("appends an edited state trigger rather than overwriting the entry it shared", () => {
        const model = sampleModel();
        const states = model.roots[0]!.states;
        states[0]!.trigger = 'Global("x","GLOBAL",9)';

        const dlg = readDlg(writeDlgFromModel(original(), model, "TEST"));

        // Appended, because another entry may point at index 0 and inserting would renumber the table.
        expect(dlg.stateTriggers).toEqual(['Global("x","GLOBAL",1)', 'Global("x","GLOBAL",9)']);
        expect(dlg.stateTriggers[dlg.states[0]!.triggerIndex]).toBe('Global("x","GLOBAL",9)');
    });

    it("keeps an untouched trigger at its original index", () => {
        const dlg = readDlg(writeDlgFromModel(original(), sampleModel(), "TEST"));

        expect(dlg.stateTriggers).toEqual(['Global("x","GLOBAL",1)']);
        expect(dlg.states[0]!.triggerIndex).toBe(0);
    });

    it("writes an edited reply condition into the transition trigger table", () => {
        const model = sampleModel();
        const choice = model.roots[0]!.states[0]!.choices[1]!;
        choice.condition = 'Global("y","GLOBAL",7)';

        const dlg = readDlg(writeDlgFromModel(original(), model, "TEST"));

        expect(dlg.transitionTriggers).toEqual(['Global("y","GLOBAL",2)', 'Global("y","GLOBAL",7)']);
        expect(dlg.transitionTriggers[dlg.transitions[1]!.triggerIndex]).toBe('Global("y","GLOBAL",7)');
        expect(dlg.transitions[1]!.flags).toContain("trigger");
    });

    it("writes an edited reply action into the action table", () => {
        const model = sampleModel();
        model.roots[0]!.states[0]!.choices[1]!.action = 'SetGlobal("z","GLOBAL",8)';

        const dlg = readDlg(writeDlgFromModel(original(), model, "TEST"));

        expect(dlg.actions).toEqual(['SetGlobal("z","GLOBAL",3)', 'SetGlobal("z","GLOBAL",8)']);
        expect(dlg.actions[dlg.transitions[1]!.actionIndex]).toBe('SetGlobal("z","GLOBAL",8)');
        expect(dlg.transitions[1]!.flags).toContain("action");
    });

    it("clears the flag when a condition or action is emptied", () => {
        const model = sampleModel();
        const choice = model.roots[0]!.states[0]!.choices[1]!;
        choice.condition = undefined;
        choice.action = undefined;

        const dlg = readDlg(writeDlgFromModel(original(), model, "TEST"));

        expect(dlg.transitions[1]!.flags).not.toContain("trigger");
        expect(dlg.transitions[1]!.flags).not.toContain("action");
        expect(dlg.transitions[1]!.triggerIndex).toBe(-1);
        expect(dlg.transitions[1]!.actionIndex).toBe(-1);
    });

    it("gives a new trigger to a state that had none", () => {
        const model = sampleModel();
        model.roots[0]!.states[1]!.trigger = 'Global("new","GLOBAL",1)';

        const dlg = readDlg(writeDlgFromModel(original(), model, "TEST"));

        expect(dlg.stateTriggers[dlg.states[1]!.triggerIndex]).toBe('Global("new","GLOBAL",1)');
    });
});
