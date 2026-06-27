import { describe, expect, it } from "vitest";
import { serializeSSLOption, serializeSSLProcedure, serializeSSLReply } from "../../shared/dialog-ssl-serialize";
import type { DialogChoice, DialogState } from "../../shared/dialog-model";

describe("serializeSSLOption", () => {
    it("serializes a node-targeted option as NOption(<id>, <target>, <skill>);", () => {
        const c: DialogChoice = { id: "x", text: "@102", target: { kind: "state", stateId: "Node002" }, skill: 4 };
        expect(serializeSSLOption(c, 102)).toBe("NOption(102, Node002, 4);");
    });

    it("omits the skill argument when absent", () => {
        const c: DialogChoice = { id: "x", text: "@102", target: { kind: "state", stateId: "Node002" } };
        expect(serializeSSLOption(c, 102)).toBe("NOption(102, Node002);");
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
