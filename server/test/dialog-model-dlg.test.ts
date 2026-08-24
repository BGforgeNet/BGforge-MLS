/**
 * DLG -> DialogModel adapter.
 *
 * A DLG holds what a `.d` file holds - states with text and a trigger, transitions with a reply, a condition,
 * an action and a target - so it produces the same model D does rather than a parallel one, and renders
 * through the same graph. What it does NOT have is source text - so instead of anchoring edits to byte
 * ranges, the model carries each state's and reply's file position, and the writer rebuilds the file.
 */

import { describe, expect, test } from "vitest";
import { modelFromDlg, modelFromDlgs, type DlgModelInput } from "../../shared/dialog-model-dlg";
import { nodeEditable } from "../../shared/dialog-editability";
import { stateHeadLabel } from "../../shared/dialog-model";

/** Two states: state 0 says @100 under a trigger and offers three replies; state 1 is a plain reply target. */
function sampleDlg(): DlgModelInput {
    return {
        states: [
            { text: 100, firstTransition: 0, transitionCount: 3, triggerIndex: 0 },
            { text: 101, firstTransition: 3, transitionCount: 0, triggerIndex: -1 },
        ],
        transitions: [
            // Reply with a condition and an action, going to state 1 of this same dialog.
            {
                text: 200,
                journalText: 0,
                triggerIndex: 0,
                actionIndex: 0,
                nextDialog: "SELFDLG\u0000",
                nextState: 1,
                hasText: true,
                hasTrigger: true,
                hasAction: true,
                hasJournalEntry: false,
                terminatesDialog: false,
            },
            // Reply that ends the conversation.
            {
                text: 201,
                journalText: 0,
                triggerIndex: -1,
                actionIndex: -1,
                nextDialog: "\u0000".repeat(8),
                nextState: 0,
                hasText: true,
                hasTrigger: false,
                hasAction: false,
                hasJournalEntry: false,
                terminatesDialog: true,
            },
            // Reply that hands off to a different dialog.
            {
                text: 202,
                journalText: 0,
                triggerIndex: -1,
                actionIndex: -1,
                nextDialog: "OTHERDLG",
                nextState: 4,
                hasText: true,
                hasTrigger: false,
                hasAction: false,
                hasJournalEntry: false,
                terminatesDialog: false,
            },
        ],
        stateTriggers: ["NumTimesTalkedTo(0)"],
        transitionTriggers: ['Global("x","GLOBAL",1)'],
        actions: ['SetGlobal("x","GLOBAL",2)'],
        resref: "SELFDLG",
    };
}

describe("modelFromDlg", () => {
    test("produces a single dialog root labelled with the resref", () => {
        const model = modelFromDlg(sampleDlg());

        expect(model.sourceLang).toBe("dlg");
        expect(model.roots).toHaveLength(1);
        expect(model.roots[0]!.kind).toBe("dialog");
        expect(model.roots[0]!.label).toBe("SELFDLG");
        expect(model.roots[0]!.states).toHaveLength(2);
    });

    test("gives each state its trigger and its own slice of the transition table", () => {
        const [first, second] = modelFromDlg(sampleDlg()).roots[0]!.states;

        expect(first!.trigger).toBe("NumTimesTalkedTo(0)");
        expect(first!.choices).toHaveLength(3);
        // A state with triggerIndex -1 is ungated, not gated by trigger 0.
        expect(second!.trigger).toBeUndefined();
        expect(second!.choices).toHaveLength(0);
    });

    test("carries each state's file position as an explicit key, not only as its id", () => {
        // The id has to become dialog-qualified once a tree can hold states from more than one file, so the
        // writer cannot keep reading the index back out of it. `dlgIndex` is that stable key, the way
        // `sourceRange` is for a D state.
        const states = modelFromDlg(sampleDlg()).roots[0]!.states;

        expect(states.map((s) => s.dlgIndex)).toEqual([0, 1]);
        expect(states.map((s) => s.dlgResref)).toEqual(["SELFDLG", "SELFDLG"]);
    });

    test("gives each choice the transition index it came from, so a reply maps back to its record", () => {
        const choices = modelFromDlg(sampleDlg()).roots[0]!.states[0]!.choices;

        expect(choices.map((c) => c.dlgTransition)).toEqual([0, 1, 2]);
    });

    test("carries strrefs as @refs so they resolve through the same path as .msg and .tra", () => {
        const state = modelFromDlg(sampleDlg()).roots[0]!.states[0]!;

        expect(state.text).toBe("@100");
        expect(state.choices[0]!.text).toBe("@200");
    });

    test("attaches a transition's condition and action only when its flag bits are set", () => {
        const choices = modelFromDlg(sampleDlg()).roots[0]!.states[0]!.choices;

        expect(choices[0]!.condition).toBe('Global("x","GLOBAL",1)');
        expect(choices[0]!.action).toBe('SetGlobal("x","GLOBAL",2)');
        // Index -1 with the bit clear must not be read as "the last entry".
        expect(choices[1]!.condition).toBeUndefined();
        expect(choices[1]!.action).toBeUndefined();
    });

    test("names every state by its dialog as well as its number, so two dialogs can share one tree", () => {
        const model = modelFromDlg(sampleDlg());

        expect(model.roots[0]!.states.map((s) => s.id)).toEqual(["SELFDLG:0", "SELFDLG:1"]);
    });

    test("distinguishes an in-dialog jump, an exit, and a hand-off to another dialog", () => {
        const choices = modelFromDlg(sampleDlg()).roots[0]!.states[0]!.choices;

        // The NUL padding on the resref must not stop it matching this dialog's own name.
        expect(choices[0]!.target).toEqual({ kind: "state", stateId: "SELFDLG:1" });
        expect(choices[1]!.target).toEqual({ kind: "exit" });
        // A dialog the model does not hold stays external - there is no node to point at.
        expect(choices[2]!.target).toEqual({ kind: "external", label: "OTHERDLG:4", resolved: false });
    });

    test("is not blanket-editable, but every state is editable through the shared gate", () => {
        // `editable` is the D-family's "every state, freely" flag and drives the inspector's read-only
        // banner; a DLG stays off it and is decided per node instead. The gate now says yes, because the
        // writer rebuilds the whole file from the model rather than splicing source text.
        const model = modelFromDlg(sampleDlg());

        expect(model.editable).toBe(false);
        for (const state of model.roots[0]!.states) {
            expect(nodeEditable(model, state)).toBe(true);
        }
    });
});

/**
 * A second dialog, deep enough to hold the state 4 that `sampleDlg` hands off to, and whose state 1 jumps
 * back into SELFDLG state 0 - the out-and-back shape.
 */
function otherDlg(): DlgModelInput {
    return {
        resref: "OTHERDLG",
        states: [
            { text: 300, firstTransition: 0, transitionCount: 0, triggerIndex: -1 },
            { text: 301, firstTransition: 0, transitionCount: 1, triggerIndex: -1 },
            { text: 302, firstTransition: 0, transitionCount: 0, triggerIndex: -1 },
            { text: 303, firstTransition: 0, transitionCount: 0, triggerIndex: -1 },
            { text: 304, firstTransition: 0, transitionCount: 0, triggerIndex: -1 },
        ],
        transitions: [
            {
                text: 400,
                journalText: 0,
                triggerIndex: -1,
                actionIndex: -1,
                nextDialog: "SELFDLG",
                nextState: 0,
                hasText: true,
                hasTrigger: false,
                hasAction: false,
                hasJournalEntry: false,
                terminatesDialog: false,
            },
        ],
        stateTriggers: [],
        transitionTriggers: [],
        actions: [],
    };
}

describe("modelFromDlgs - one tree spanning several dialogs", () => {
    // Only the states actually referenced are pulled in. A companion's dialog runs to hundreds of states, and
    // loading one whole to close a single edge buries the file being edited under it.
    const tree = () => modelFromDlgs(sampleDlg(), [{ dlg: otherDlg(), include: [1, 4] }]);

    test("puts the dialog being edited first and each other dialog after it", () => {
        const model = tree();

        expect(model.roots.map((r) => r.label)).toEqual(["SELFDLG", "OTHERDLG"]);
        expect(model.roots[0]!.external).toBeFalsy();
    });

    test("marks the other dialogs as external, so the view can say these are not this file", () => {
        expect(tree().roots[1]!.external).toBe(true);
    });

    test("resolves a jump into a loaded dialog into a real target, not an address string", () => {
        // Unresolved it renders as a dead-end label; resolved it is a node the tree can actually draw.
        const handOff = tree().roots[0]!.states[0]!.choices[2]!;

        expect(handOff.target).toEqual({ kind: "state", stateId: "OTHERDLG:4" });
    });

    test("closes an out-and-back jump onto the state it came from", () => {
        const back = tree().roots[1]!.states[0]!.choices[0]!;

        // OTHERDLG's reply points at SELFDLG:0, which is a node already in this tree.
        expect(back.target).toEqual({ kind: "state", stateId: "SELFDLG:0" });
    });

    test("keeps each state addressed to its own file, so a write cannot cross into the wrong one", () => {
        const model = tree();

        expect(new Set(model.roots[1]!.states.map((s) => s.dlgResref))).toEqual(new Set(["OTHERDLG"]));
        // The numbers are the neighbour's own, not positions in the shortened list.
        expect(model.roots[1]!.states.map((s) => s.dlgIndex)).toEqual([1, 4]);
    });

    test("brings in only the states that were asked for, not the whole neighbouring file", () => {
        expect(tree().roots[1]!.states.map((s) => s.id)).toEqual(["OTHERDLG:1", "OTHERDLG:4"]);
    });

    test("leaves a jump into a dialog that was not loaded external", () => {
        const model = modelFromDlgs(sampleDlg(), []);

        expect(model.roots[0]!.states[0]!.choices[2]!.target).toEqual({
            kind: "external",
            label: "OTHERDLG:4",
            resolved: false,
        });
    });

    test("labels each state with its own dialog, not with the file that happens to be open", () => {
        // The header falls back to the model's `sourceName` when a state names no speaker, which would put
        // the edited file's name on a neighbour's card - "MINSC - VICONIA:0", a speaker who is not speaking.
        const model = tree();

        expect(stateHeadLabel(model.roots[1]!.states[0]!, model.sourceName)).toBe("OTHERDLG - OTHERDLG:1");
        expect(stateHeadLabel(model.roots[0]!.states[0]!, model.sourceName)).toBe("SELFDLG - SELFDLG:0");
    });

    test("names the dialog being written, so a state from another file is not treated as this file's", () => {
        // Every other family has the host set `sourceName` from the document; here it also decides which
        // states are editable, so the adapter that knows which dialog is the main one sets it.
        expect(tree().sourceName).toBe("SELFDLG");
        for (const state of tree().roots[1]!.states) expect(nodeEditable(tree(), state)).toBe(false);
    });

    test("leaves a jump at a state that was not brought in external rather than pointing at nothing", () => {
        // The bound on how many states are pulled in, and a mod that replaces a dialog with a shorter one,
        // both land here: resolving would put an edge in the tree with no node on the far end.
        const partial = modelFromDlgs(sampleDlg(), [{ dlg: otherDlg(), include: [1] }]);

        expect(partial.roots[0]!.states[0]!.choices[2]!.target).toEqual({
            kind: "external",
            label: "OTHERDLG:4",
            resolved: false,
        });
    });

    test("ignores a state number the neighbouring file does not have", () => {
        const model = modelFromDlgs(sampleDlg(), [{ dlg: otherDlg(), include: [4, 99] }]);

        expect(model.roots[1]!.states.map((s) => s.dlgIndex)).toEqual([4]);
    });
});
