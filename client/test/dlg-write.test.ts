import { describe, expect, it } from "vitest";
import { buildDlg, readDlg, type DlgBuildInput } from "@bgforge/binary";
import { applyDlgTextEdits } from "../src/dialog-editor/dlg-write";

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

describe("applyDlgTextEdits", () => {
    it("rewrites a state's line to the chosen string", () => {
        const dlg = readDlg(applyDlgTextEdits(original(), [{ stateIndex: 1, strref: 99 }]));
        expect(dlg.states[1]!.text).toBe(99);
        expect(dlg.states[0]!.text).toBe(10);
    });

    it("rewrites a reply, addressing it by its position within its state", () => {
        // State 1's only reply is transition 2 - a position-within-state of 0, not a table index of 0.
        const dlg = readDlg(applyDlgTextEdits(original(), [{ stateIndex: 1, choiceIndex: 0, strref: 98 }]));
        expect(dlg.transitions[2]!.text).toBe(98);
        expect(dlg.transitions[0]!.text).toBe(20);
    });

    it("marks a reply as carrying text, so one that had none now shows it", () => {
        // Transition 2 starts with no text flag; without setting it the strref is stored but never read.
        const dlg = readDlg(applyDlgTextEdits(original(), [{ stateIndex: 1, choiceIndex: 0, strref: 98 }]));
        expect(dlg.transitions[2]!.hasText).toBe(true);
    });

    it("applies every edit in one rewrite", () => {
        const dlg = readDlg(
            applyDlgTextEdits(original(), [
                { stateIndex: 0, strref: 1 },
                { stateIndex: 0, choiceIndex: 1, strref: 2 },
            ]),
        );
        expect(dlg.states[0]!.text).toBe(1);
        expect(dlg.transitions[1]!.text).toBe(2);
    });

    it("keeps everything the model does not carry - journal text, triggers, actions, targets", () => {
        const dlg = readDlg(applyDlgTextEdits(original(), [{ stateIndex: 0, strref: 1 }]));
        expect(dlg.transitions[1]!.journalText).toBe(500);
        expect(dlg.transitions[1]!.hasJournalEntry).toBe(true);
        expect(dlg.stateTriggers).toEqual(sample().stateTriggers);
        expect(dlg.transitionTriggers).toEqual(sample().transitionTriggers);
        expect(dlg.actions).toEqual(sample().actions);
        expect(dlg.transitions[0]!.nextState).toBe(1);
        expect(dlg.states[0]!.triggerIndex).toBe(0);
    });

    it("leaves the file unchanged when there is nothing to apply", () => {
        expect(applyDlgTextEdits(original(), [])).toEqual(original());
    });

    it("refuses an edit that addresses a state the file does not have", () => {
        expect(() => applyDlgTextEdits(original(), [{ stateIndex: 5, strref: 1 }])).toThrow(/state/i);
    });

    it("refuses an edit that addresses a reply the state does not have", () => {
        expect(() => applyDlgTextEdits(original(), [{ stateIndex: 1, choiceIndex: 3, strref: 1 }])).toThrow(/reply/i);
    });
});
