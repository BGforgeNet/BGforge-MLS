/**
 * DLG -> DialogModel adapter.
 *
 * A DLG holds what a `.d` file holds - states with text and a trigger, transitions with a reply, a condition,
 * an action and a target - so it produces the same model D does rather than a parallel one, and renders
 * through the same graph. What it does NOT have is source text: there are no byte ranges to anchor an edit
 * to, which is why the model comes back read-only for now.
 */

import { describe, expect, test } from "vitest";
import { modelFromDlg, type DlgModelInput } from "../../shared/dialog-model-dlg";
import { nodeEditable } from "../../shared/dialog-editability";

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

    test("distinguishes an in-dialog jump, an exit, and a hand-off to another dialog", () => {
        const choices = modelFromDlg(sampleDlg()).roots[0]!.states[0]!.choices;

        // The NUL padding on the resref must not stop it matching this dialog's own name.
        expect(choices[0]!.target).toEqual({ kind: "state", stateId: "1" });
        expect(choices[1]!.target).toEqual({ kind: "exit" });
        expect(choices[2]!.target).toEqual({ kind: "external", label: "OTHERDLG:4", resolved: false });
    });

    test("is read-only: a DLG has no source text to anchor an edit to", () => {
        const model = modelFromDlg(sampleDlg());

        expect(model.editable).toBe(false);
        for (const state of model.roots[0]!.states) {
            expect(nodeEditable(model, state)).toBe(false);
        }
    });
});
