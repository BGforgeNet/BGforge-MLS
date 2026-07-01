import { describe, expect, it } from "vitest";
import {
    serializeSSLBranch,
    serializeSSLOption,
    serializeSSLProcedure,
    serializeSSLReply,
} from "../../shared/dialog-ssl-serialize";
import type { DialogChoice, DialogState } from "../../shared/dialog-model";

describe("serializeSSLOption", () => {
    it("serializes a node-targeted option as NOption(<id>, <target>, <skill>);", () => {
        const c: DialogChoice = { id: "x", text: "@102", target: { kind: "state", stateId: "Node002" }, skill: 4 };
        expect(serializeSSLOption(c, 102)).toBe("NOption(102, Node002, 4);");
    });

    it("defaults the skill argument to 0 (no INT gate) when absent - non-Low is always 3-arg", () => {
        const c: DialogChoice = { id: "x", text: "@102", target: { kind: "state", stateId: "Node002" } };
        expect(serializeSSLOption(c, 102)).toBe("NOption(102, Node002, 0);");
    });

    it("emits the reaction prefix from choice.reaction (default neutral)", () => {
        const good: DialogChoice = {
            id: "x",
            text: "@102",
            target: { kind: "state", stateId: "Node002" },
            reaction: "good",
        };
        const bad: DialogChoice = {
            id: "x",
            text: "@102",
            target: { kind: "state", stateId: "Node002" },
            reaction: "bad",
        };
        expect(serializeSSLOption(good, 102)).toBe("GOption(102, Node002, 0);");
        expect(serializeSSLOption(bad, 102)).toBe("BOption(102, Node002, 0);");
    });

    it("emits the 2-arg Low form (no skill arg) when lowIq is set", () => {
        const c: DialogChoice = {
            id: "x",
            text: "@102",
            target: { kind: "state", stateId: "Node002" },
            reaction: "good",
            lowIq: true,
            skill: 4, // ignored for the Low form - the engine hardcodes LOW_IQ, there is no arg slot for it
        };
        expect(serializeSSLOption(c, 102)).toBe("GLowOption(102, Node002);");
    });

    it("serializes an exit option as a terminal NMessage(<id>);", () => {
        const c: DialogChoice = { id: "x", text: "@102", target: { kind: "exit" } };
        expect(serializeSSLOption(c, 102)).toBe("NMessage(102);");
    });
});

describe("serializeSSLReply", () => {
    it("serializes a Reply call by msg id", () => {
        expect(serializeSSLReply(300)).toBe("Reply(300);");
    });
});

describe("serializeSSLProcedure", () => {
    it("emits a procedure with the reply line then each option, indented", () => {
        const state: DialogState = {
            id: "Node050",
            text: "@300",
            choices: [
                { id: "Node050#opt0", text: "@301", target: { kind: "state", stateId: "Node002" }, skill: 4 },
                { id: "Node050#opt1", text: "@302", target: { kind: "exit" } },
            ],
        };
        const ids = { reply: 300, options: { "Node050#opt0": 301, "Node050#opt1": 302 } };
        expect(serializeSSLProcedure(state, ids, "    ")).toBe(
            "procedure Node050 begin\n    Reply(300);\n    NOption(301, Node002, 4);\n    NMessage(302);\nend",
        );
    });

    it("omits the reply line when the node has no text", () => {
        const state: DialogState = { id: "Node051", text: "", choices: [] };
        expect(serializeSSLProcedure(state, { reply: undefined, options: {} }, "    ")).toBe(
            "procedure Node051 begin\nend",
        );
    });
});

describe("serializeSSLBranch", () => {
    it("emits an if-branch with one option at indent+4 spaces, closed by indent+end", () => {
        const c: DialogChoice = { id: "x", text: "@200", target: { kind: "state", stateId: "Node9" }, skill: 4 };
        expect(serializeSSLBranch("if", "(a == 1)", [], [{ choice: c, msgId: 200 }], "    ")).toBe(
            "if (a == 1) then begin\n        NOption(200, Node9, 4);\n    end",
        );
    });

    it("emits begin then indent+end with no body lines when replies and options are both empty", () => {
        expect(serializeSSLBranch("if", "(a == 1)", [], [], "    ")).toBe("if (a == 1) then begin\n    end");
    });

    it("emits else begin without a condition for an else-branch", () => {
        expect(serializeSSLBranch("else", undefined, [], [], "    ")).toBe("else begin\n    end");
    });
});
