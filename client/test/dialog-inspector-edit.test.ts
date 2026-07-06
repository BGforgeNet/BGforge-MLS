import { describe, expect, it } from "vitest";
import {
    conditionLockReason,
    isPendingChoice,
    isPendingState,
    msgRef,
    optionRemoveLockReason,
    stateReadOnlyReason,
    structuralLockReason,
    textFieldLocked,
    textLockReason,
} from "../src/dialog-editor/webview/inspector-edit";
import { modelFromSSL, type DialogChoice, type DialogState } from "../../shared/dialog-model";
import type { SSLDialogData } from "../../shared/dialog-types";

describe("msgRef", () => {
    it("parses a bare @N line to its numeric id", () => {
        expect(msgRef("@200")).toBe("200");
        expect(msgRef("  @201  ")).toBe("201"); // surrounding whitespace tolerated
    });
    it("returns null for literal or non-@N text", () => {
        expect(msgRef("The town is quiet")).toBeNull();
        expect(msgRef("@abc")).toBeNull();
        expect(msgRef(undefined)).toBeNull();
        expect(msgRef("")).toBeNull();
    });
});

describe("textFieldLocked", () => {
    const messages = { "200": "The town is quiet these days.", "201": "" };

    it("locks any field of a read-only state", () => {
        expect(textFieldLocked({ text: "@200", messages, ssl: true, textRO: true })).toBe(true);
        expect(textFieldLocked({ text: "@200", messages, ssl: false, textRO: true })).toBe(true);
    });

    it("D: a literal text field is editable (D persists literals via the .d splice)", () => {
        expect(textFieldLocked({ text: "Some literal line", messages, ssl: false, textRO: false })).toBe(false);
        expect(textFieldLocked({ text: "@200", messages, ssl: false, textRO: false })).toBe(false);
    });

    it("SSL: an @N field whose .msg entry resolved is editable", () => {
        expect(textFieldLocked({ text: "@200", messages, ssl: true, textRO: false })).toBe(false);
        // An empty-string entry is still a resolved entry - editable.
        expect(textFieldLocked({ text: "@201", messages, ssl: true, textRO: false })).toBe(false);
    });

    it("SSL: an @N field whose .msg entry did NOT load is locked (would silently lose the edit)", () => {
        // The bug: ref is non-null so the old guard left it editable, but there is no .msg line to write.
        expect(textFieldLocked({ text: "@999", messages, ssl: true, textRO: false })).toBe(true);
        expect(textFieldLocked({ text: "@200", messages: undefined, ssl: true, textRO: false })).toBe(true);
        expect(textFieldLocked({ text: "@200", messages: {}, ssl: true, textRO: false })).toBe(true);
    });

    it("SSL: a literal (non-@N) field is locked - SSL save only writes resolvable .msg entries", () => {
        expect(textFieldLocked({ text: "raw literal", messages, ssl: true, textRO: false })).toBe(true);
    });

    it("SSL: a PENDING-NEW field is editable so the user can type its initial text (allocated an @id at save)", () => {
        // A just-added option/node starts with empty (or literal) text and no .msg entry; locking it would
        // make add-option / add-node unusable for SSL. textRO still wins.
        expect(textFieldLocked({ text: "", messages, ssl: true, textRO: false, isNew: true })).toBe(false);
        expect(textFieldLocked({ text: "typed literal", messages, ssl: true, textRO: false, isNew: true })).toBe(false);
        expect(textFieldLocked({ text: "", messages, ssl: true, textRO: true, isNew: true })).toBe(true);
    });

    it("isNew defaults to false - an existing unresolvable @N stays locked", () => {
        expect(textFieldLocked({ text: "@999", messages, ssl: true, textRO: false })).toBe(true);
    });
});

describe("isPendingChoice", () => {
    it("a choice with no source span of any kind is pending-new", () => {
        expect(isPendingChoice({ id: "x", text: "", target: { kind: "exit" } })).toBe(true);
    });
    it("an existing option (callRange or stmtRange) is not pending", () => {
        expect(
            isPendingChoice({ id: "x", text: "@1", target: { kind: "exit" }, callRange: { start: 0, end: 1 } }),
        ).toBe(false);
        expect(
            isPendingChoice({ id: "x", text: "@1", target: { kind: "exit" }, stmtRange: { start: 0, end: 1 } }),
        ).toBe(false);
    });
    it("a call transition (callSites) is not pending", () => {
        expect(
            isPendingChoice({
                id: "x",
                target: { kind: "state", stateId: "N" },
                callSites: [{ stmtRange: { start: 0, end: 1 }, topLevel: true }],
            }),
        ).toBe(false);
    });
});

describe("isPendingState", () => {
    it("a state with no procRange is pending-new; with a procRange it is not", () => {
        expect(isPendingState({ id: "N", text: "", choices: [] })).toBe(true);
        expect(isPendingState({ id: "N", text: "", choices: [], procRange: { start: 0, end: 1 } })).toBe(false);
    });
});

describe("disabled-reason helpers", () => {
    const st = (over: Partial<DialogState> = {}): DialogState => ({
        id: "Node001",
        text: "@200",
        choices: [],
        ...over,
    });
    const ch = (over: Partial<DialogChoice> = {}): DialogChoice => ({ id: "c0", target: { kind: "exit" }, ...over });
    const messages = { "200": "The town is quiet." };

    it("stateReadOnlyReason names the derived construct, else says read-only", () => {
        expect(stateReadOnlyReason("CHAIN")).toContain("CHAIN");
        expect(stateReadOnlyReason("CHAIN")).toMatch(/CHAIN source/);
        expect(stateReadOnlyReason(undefined)).toBe("This dialog is open read-only.");
    });

    it("structuralLockReason distinguishes derived, approximate, structured, and generic SSL nodes", () => {
        expect(structuralLockReason(st({ derivedFrom: "INTERJECT" }), true, false)).toContain("INTERJECT");
        expect(structuralLockReason(st({ approximate: true }), true, false)).toMatch(/loop or switch/);
        expect(structuralLockReason(st({ structured: true }), true, false)).toMatch(/nests if\/else/);
        expect(structuralLockReason(st(), true, false)).toMatch(/isn't simple enough/);
        // Non-SSL (D): editable file -> no reason; view-only -> read-only.
        expect(structuralLockReason(st(), false, true)).toBe("");
        expect(structuralLockReason(st(), false, false)).toBe("This dialog is open read-only.");
        // Each SSL reason points the user at the source.
        expect(structuralLockReason(st({ structured: true }), true, false)).toMatch(/\.ssl source/);
    });

    it("textLockReason explains an unresolved @N vs a literal, and is empty when editable", () => {
        // Editable resolvable @N -> no reason.
        expect(textLockReason({ text: "@200", messages, ssl: true, textRO: false })).toBe("");
        // Unresolved @N -> names the id and points at translation.directory.
        const unresolved = textLockReason({ text: "@999", messages, ssl: true, textRO: false });
        expect(unresolved).toContain("@999");
        expect(unresolved).toMatch(/translation\.directory/);
        // Literal (no @N) -> says there's no .msg entry.
        expect(textLockReason({ text: "raw", messages, ssl: true, textRO: false })).toMatch(/no plain @N/);
        // Read-only derived state -> derived wording.
        expect(textLockReason({ text: "@200", messages, ssl: true, textRO: true, derivedFrom: "EXTEND" })).toContain(
            "EXTEND",
        );
    });

    it("conditionLockReason distinguishes a read-only structure from a shared condition", () => {
        expect(conditionLockReason(st({ structured: true }), ch({ conditionEditable: false }), true, false)).toMatch(
            /can't round-trip/,
        );
        expect(conditionLockReason(st(), ch({ conditionEditable: false }), true, false)).toMatch(
            /gates more than just this option/,
        );
        // Editable condition -> no reason.
        expect(conditionLockReason(st(), ch({ conditionEditable: true }), true, false)).toBe("");
    });

    it("optionRemoveLockReason points at the .ssl source", () => {
        expect(optionRemoveLockReason()).toMatch(/\.ssl source/);
    });
});

it("derives conditionEditable from ifPure (gates the option alone) and absence of a condition", () => {
    const data: SSLDialogData = {
        entryPoints: ["Node001"],
        nodes: [
            {
                name: "Node001",
                line: 1,
                callTargets: [],
                replies: [],
                faithful: true,
                options: [
                    { type: "NOption", msgId: 101, target: "Node002", line: 2 }, // unconditional
                    {
                        type: "NOption",
                        msgId: 102,
                        target: "Node003",
                        line: 3,
                        conditional: "(x)",
                        condRange: { start: 0, end: 3 },
                        ifRange: { start: 0, end: 9 },
                        ifPure: true,
                    },
                    {
                        type: "NOption",
                        msgId: 104,
                        target: "Node004",
                        line: 4,
                        conditional: "(y)",
                        condRange: { start: 10, end: 13 },
                        ifRange: { start: 10, end: 19 },
                        ifPure: false,
                    },
                ],
            },
        ],
    };
    const model = modelFromSSL(data);
    const choices = model.roots[0]!.states[0]!.choices;
    expect(choices[0]!.conditionEditable).toBe(true); // unconditional
    expect(choices[1]!.conditionEditable).toBe(true); // pure if (gates this option alone)
    expect(choices[2]!.conditionEditable).toBe(false); // shared/impure if
    expect(choices[1]!.condRange).toEqual({ start: 0, end: 3 });
    expect(choices[1]!.ifRange).toEqual({ start: 0, end: 9 });
});
