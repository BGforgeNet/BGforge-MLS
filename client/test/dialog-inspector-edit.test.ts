import { describe, expect, it } from "vitest";
import { msgRef, textFieldLocked } from "../src/dialog-editor/webview/inspector-edit";

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
});
