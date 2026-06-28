import { describe, expect, it } from "vitest";
import { isPendingChoice, isPendingState, msgRef, textFieldLocked } from "../src/dialog-editor/webview/inspector-edit";

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
    it("a call transition (callStmtRange) is not pending", () => {
        expect(
            isPendingChoice({ id: "x", target: { kind: "state", stateId: "N" }, callStmtRange: { start: 0, end: 1 } }),
        ).toBe(false);
    });
});

describe("isPendingState", () => {
    it("a state with no procRange is pending-new; with a procRange it is not", () => {
        expect(isPendingState({ id: "N", text: "", choices: [] })).toBe(true);
        expect(isPendingState({ id: "N", text: "", choices: [], procRange: { start: 0, end: 1 } })).toBe(false);
    });
});
