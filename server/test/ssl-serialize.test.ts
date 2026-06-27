import { describe, expect, it } from "vitest";
import { serializeSSLOption } from "../../shared/dialog-ssl-serialize";
import type { DialogChoice } from "../../shared/dialog-model";

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
