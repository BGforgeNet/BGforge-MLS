import { describe, expect, it } from "vitest";
import { modelFromDlg, type DlgModelInput } from "../../shared/dialog-model-dlg";
import { detachDlgState, dlgAddress, setDlgLineText } from "../../shared/dialog-dlg-edit";
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

describe("setDlgLineText", () => {
    it("points a state's own line at the chosen string", () => {
        const after = setDlgLineText(model(), "TEST", { stateIndex: 1 }, 99);
        expect(after.roots[0]!.states[1]!.text).toBe("@99");
        expect(after.roots[0]!.states[0]!.text).toBe("@10");
    });

    it("points a reply at the chosen string, addressing it within its state", () => {
        const after = setDlgLineText(model(), "TEST", { stateIndex: 0, choiceIndex: 1 }, 98);
        expect(after.roots[0]!.states[0]!.choices[1]!.text).toBe("@98");
        expect(after.roots[0]!.states[0]!.choices[0]!.text).toBe("@20");
    });

    it("leaves the model it was given untouched", () => {
        const before = model();
        setDlgLineText(before, "TEST", { stateIndex: 1 }, 99);
        expect(before.roots[0]!.states[1]!.text).toBe("@11");
    });

    it("finds the state by its file index, not by its place in the list", () => {
        const withExternal = structuredClone(model()) as DialogModel;
        withExternal.roots.unshift({
            id: "dialog:OTHER",
            label: "OTHER",
            kind: "dialog",
            states: [{ id: "OTHER:0", dlgIndex: 0, dlgResref: "OTHER", text: "@70", choices: [] }],
        });

        const after = setDlgLineText(withExternal, "TEST", { stateIndex: 0 }, 55);

        expect(after.roots[1]!.states[0]!.text).toBe("@55");
        // The other dialog's state 0 is a different state and must not be touched.
        expect(after.roots[0]!.states[0]!.text).toBe("@70");
    });

    it("refuses an address the dialog does not hold", () => {
        expect(() => setDlgLineText(model(), "TEST", { stateIndex: 9 }, 1)).toThrow(/state/i);
        expect(() => setDlgLineText(model(), "TEST", { stateIndex: 0, choiceIndex: 7 }, 1)).toThrow(/reply/i);
    });
});

describe("detachDlgState", () => {
    it("keeps the state and its number, so nothing above it renumbers", () => {
        const { model: after } = detachDlgState(model(), "TEST", 1);
        const states = after.roots[0]!.states;

        expect(states).toHaveLength(2);
        expect(states[1]!.dlgIndex).toBe(1);
        expect(states[1]!.text).toBe("@11");
    });

    it("turns every reply that led there into one that ends the conversation", () => {
        const { model: after } = detachDlgState(model(), "TEST", 1);

        // State 0's first reply pointed at state 1; it now ends the dialog instead.
        expect(after.roots[0]!.states[0]!.choices[0]!.target).toEqual({ kind: "exit" });
    });

    it("reports exactly which replies it changed, so the user can be told", () => {
        const { cut } = detachDlgState(model(), "TEST", 1);

        expect(cut).toEqual([{ stateIndex: 0, choiceIndex: 0 }]);
    });

    it("leaves replies that pointed elsewhere alone", () => {
        const before = model();
        const { model: after } = detachDlgState(before, "TEST", 1);

        // State 0's second reply already ended the dialog and is not part of this change.
        expect(after.roots[0]!.states[0]!.choices[1]!.target).toEqual({ kind: "exit" });
        expect(after.roots[0]!.states[1]!.choices).toHaveLength(1);
    });

    it("cuts a reply that led back into the detached state from itself", () => {
        const selfish = structuredClone(model()) as DialogModel;
        selfish.roots[0]!.states[1]!.choices[0]!.target = { kind: "state", stateId: selfish.roots[0]!.states[1]!.id };

        const { model: after, cut } = detachDlgState(selfish, "TEST", 1);

        expect(after.roots[0]!.states[1]!.choices[0]!.target).toEqual({ kind: "exit" });
        expect(cut).toContainEqual({ stateIndex: 1, choiceIndex: 0 });
    });

    it("leaves the model it was given untouched", () => {
        const before = model();
        detachDlgState(before, "TEST", 1);

        expect(before.roots[0]!.states[0]!.choices[0]!.target).toEqual({ kind: "state", stateId: "TEST:1" });
    });

    it("refuses a state the dialog does not hold", () => {
        expect(() => detachDlgState(model(), "TEST", 9)).toThrow(/state/i);
    });
});
