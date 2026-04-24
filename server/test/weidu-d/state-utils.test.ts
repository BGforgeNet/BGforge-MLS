/**
 * Unit tests for weidu-d/state-utils.ts - shared state label utilities.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";
vi.mock("../../src/server", () => ({
    connection: {
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

import { normalizeDialogFile, findLabelNodeAtPosition, findStateInDialog } from "../../src/weidu-d/state-utils";
import { parseWithCache, initParser } from "../../src/weidu-d/parser";

beforeAll(async () => {
    await initParser();
});

describe("normalizeDialogFile", () => {
    it("strips tilde delimiters and lowercases", () => {
        expect(normalizeDialogFile("~DIALOG~")).toBe("dialog");
    });

    it("strips double-quote delimiters and lowercases", () => {
        expect(normalizeDialogFile('"MyDialog"')).toBe("mydialog");
    });

    it("lowercases without delimiters", () => {
        expect(normalizeDialogFile("PLAIN")).toBe("plain");
    });

    it("handles empty string", () => {
        expect(normalizeDialogFile("")).toBe("");
    });

    it("strips single tilde (starts and ends with same delimiter)", () => {
        expect(normalizeDialogFile("~")).toBe("");
    });
});

describe("findLabelNodeAtPosition", () => {
    function parse(text: string) {
        const tree = parseWithCache(text);
        return tree!.rootNode;
    }

    it("finds state definition label", () => {
        const root = parse("BEGIN ~DIALOG~\n\nIF ~~ THEN BEGIN my_state\n    SAY ~Hello~\nEND\n");
        const result = findLabelNodeAtPosition(root, { line: 2, character: 20 });

        expect(result).not.toBeNull();
        expect(result!.labelNode.text).toBe("my_state");
        expect(result!.dialogFile).toBe("dialog");
    });

    it("finds GOTO label", () => {
        const text = [
            "BEGIN ~DIALOG~",
            "",
            "IF ~~ THEN BEGIN s1",
            "    SAY ~Hi~",
            "    IF ~~ THEN GOTO target",
            "END",
        ].join("\n");
        const root = parse(text);
        const result = findLabelNodeAtPosition(root, { line: 4, character: 22 });

        expect(result).not.toBeNull();
        expect(result!.labelNode.text).toBe("target");
        expect(result!.dialogFile).toBe("dialog");
    });

    it("finds EXTERN label with its own dialog file", () => {
        const text = [
            "BEGIN ~DIALOG_A~",
            "",
            "IF ~~ THEN BEGIN s1",
            "    SAY ~Hi~",
            "    IF ~~ THEN EXTERN ~OTHER~ target",
            "END",
        ].join("\n");
        const root = parse(text);
        // "target" in EXTERN
        const result = findLabelNodeAtPosition(root, { line: 4, character: 30 });

        expect(result).not.toBeNull();
        expect(result!.labelNode.text).toBe("target");
        expect(result!.dialogFile).toBe("other");
    });

    it("finds EXTEND_TOP state label", () => {
        const text = "EXTEND_TOP ~DIALOG~ my_state\n    IF ~~ THEN GOTO other\nEND\n";
        const root = parse(text);
        // "my_state" in EXTEND_TOP
        const result = findLabelNodeAtPosition(root, { line: 0, character: 22 });

        expect(result).not.toBeNull();
        expect(result!.labelNode.text).toBe("my_state");
        expect(result!.dialogFile).toBe("dialog");
    });

    it("finds CHAIN label", () => {
        const text = "CHAIN ~DIALOG~ entry\n    ~Some text~\nEXIT\n";
        const root = parse(text);
        // "entry" in CHAIN
        const result = findLabelNodeAtPosition(root, { line: 0, character: 17 });

        expect(result).not.toBeNull();
        expect(result!.labelNode.text).toBe("entry");
        expect(result!.dialogFile).toBe("dialog");
    });

    it("finds ChainEpilogue label", () => {
        const text = "CHAIN ~DIALOG~ entry\n    ~Some text~\nEND ~OTHER~ target\n";
        const root = parse(text);
        // "target" in ChainEpilogue
        const result = findLabelNodeAtPosition(root, { line: 2, character: 14 });

        expect(result).not.toBeNull();
        expect(result!.labelNode.text).toBe("target");
        expect(result!.dialogFile).toBe("other");
    });

    it("finds COPY_TRANS state reference", () => {
        // COPY_TRANS appears as a transition inside a state block
        const text = [
            "BEGIN ~DIALOG~",
            "",
            "IF ~~ THEN BEGIN s1",
            "    SAY ~Hi~",
            "    COPY_TRANS ~OTHER~ target_state",
            "END",
        ].join("\n");
        const root = parse(text);
        // "target_state" in COPY_TRANS at line 4
        const result = findLabelNodeAtPosition(root, { line: 4, character: 25 });

        expect(result).not.toBeNull();
        expect(result!.labelNode.text).toBe("target_state");
        expect(result!.dialogFile).toBe("other");
    });

    it("finds ADD_STATE_TRIGGER state field (non-ExtendAction TOP_LEVEL type)", () => {
        // ADD_STATE_TRIGGER has a "state" field — exercises the else-branch of ExtendAction check
        const text = "ADD_STATE_TRIGGER ~DIALOG~ my_state ~True()~\n";
        const root = parse(text);
        // "my_state" in ADD_STATE_TRIGGER
        const result = findLabelNodeAtPosition(root, { line: 0, character: 30 });

        expect(result).not.toBeNull();
        expect(result!.labelNode.text).toBe("my_state");
        expect(result!.dialogFile).toBe("dialog");
    });

    it("returns null for non-label positions", () => {
        const root = parse("BEGIN ~DIALOG~\n\nIF ~~ THEN BEGIN s1\n    SAY ~Hello~\nEND\n");
        const result = findLabelNodeAtPosition(root, { line: 3, character: 5 });
        expect(result).toBeNull();
    });
});

describe("findStateInDialog", () => {
    function parse(text: string) {
        const tree = parseWithCache(text);
        return tree!.rootNode;
    }

    it("finds state in matching dialog", () => {
        const root = parse("BEGIN ~DIALOG~\n\nIF ~~ THEN BEGIN target\n    SAY ~Hi~\nEND\n");
        const result = findStateInDialog(root, "dialog", "target");

        expect(result).not.toBeNull();
        expect(result!.name).toBe("target");
    });

    it("returns null for non-matching dialog", () => {
        const root = parse("BEGIN ~DIALOG_A~\n\nIF ~~ THEN BEGIN target\n    SAY ~Hi~\nEND\n");
        const result = findStateInDialog(root, "dialog_b", "target");
        expect(result).toBeNull();
    });

    it("returns null for non-existing label", () => {
        const root = parse("BEGIN ~DIALOG~\n\nIF ~~ THEN BEGIN s1\n    SAY ~Hi~\nEND\n");
        const result = findStateInDialog(root, "dialog", "nonexistent");
        expect(result).toBeNull();
    });

    it("finds state in APPEND block", () => {
        const text = "APPEND ~DIALOG~\n\nIF ~~ THEN BEGIN appended\n    SAY ~Hi~\nEND\n\nEND\n";
        const root = parse(text);
        const result = findStateInDialog(root, "dialog", "appended");

        expect(result).not.toBeNull();
        expect(result!.name).toBe("appended");
    });

    it("distinguishes states across different dialogs", () => {
        const text = [
            "BEGIN ~DIALOG_A~",
            "",
            "IF ~~ THEN BEGIN shared",
            "    SAY ~From A~",
            "END",
            "",
            "BEGIN ~DIALOG_B~",
            "",
            "IF ~~ THEN BEGIN shared",
            "    SAY ~From B~",
            "END",
        ].join("\n");
        const root = parse(text);

        const resultA = findStateInDialog(root, "dialog_a", "shared");
        const resultB = findStateInDialog(root, "dialog_b", "shared");

        expect(resultA).not.toBeNull();
        expect(resultB).not.toBeNull();
        // They should be different nodes (different lines)
        expect(resultA!.stateNode.startPosition.row).not.toBe(resultB!.stateNode.startPosition.row);
    });
});
