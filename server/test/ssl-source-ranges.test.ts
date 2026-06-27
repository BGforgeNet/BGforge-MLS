import { describe, expect, it } from "vitest";
import { parseDialog } from "../src/dialog";

describe("SSL option source ranges", () => {
    it("captures the call span and the target-arg span of an NOption", async () => {
        const ssl = `procedure Node001 begin\n    NOption(101, Node002, 4);\nend\nprocedure talk_p_proc begin\n  call Node001;\nend\n`;
        const result = await parseDialog(ssl);
        const opt = result.nodes.find((n) => n.name === "Node001")!.options[0]!;
        // The whole call, used for reorder.
        expect(ssl.slice(opt.callRange!.start, opt.callRange!.end)).toBe("NOption(101, Node002, 4)");
        // Just the target argument, used for retarget.
        expect(ssl.slice(opt.targetRange!.start, opt.targetRange!.end)).toBe("Node002");
    });
});

describe("SSL node procedure range + call-statement range", () => {
    it("captures the whole procedure span and a call transition's statement span", async () => {
        const ssl = `procedure Node001 begin\n    call combat;\nend\nprocedure talk_p_proc begin\n  call Node001;\nend\n`;
        const result = await parseDialog(ssl);
        const node = result.nodes.find((n) => n.name === "Node001")!;
        expect(ssl.slice(node.procRange!.start, node.procRange!.end)).toBe(
            "procedure Node001 begin\n    call combat;\nend",
        );
        // The call transition carries the span of its whole `call combat;` statement (for delete).
        expect(node.callTransitions![0]!.name).toBe("combat");
        expect(ssl.slice(node.callTransitions![0]!.stmtRange.start, node.callTransitions![0]!.stmtRange.end)).toBe(
            "call combat;",
        );
    });
});

describe("SSL statement range + insertion anchor", () => {
    it("captures an option's full statement span (call + semicolon) and the node insert anchor", async () => {
        const ssl = `procedure Node001 begin\n    NOption(101, Node002, 4);\nend\nprocedure talk_p_proc begin\n  call Node001;\nend\n`;
        const result = await parseDialog(ssl);
        const node = result.nodes.find((n) => n.name === "Node001")!;
        const opt = node.options[0]!;
        // stmtRange spans the whole statement including the trailing semicolon.
        expect(ssl.slice(opt.stmtRange!.start, opt.stmtRange!.end)).toBe("NOption(101, Node002, 4);");
        // The insert anchor sits at the end of the last body statement, so a new call splices right after it.
        expect(opt.stmtRange!.end).toBe(node.insertAnchor!.offset);
        // The anchor records the body indentation ("    ") so an inserted call lines up.
        expect(node.insertAnchor!.indent).toBe("    ");
    });
});

describe("SSL name + entry-call ranges", () => {
    it("captures the procedure name token, the talk_p_proc entry-call spans, and call target tokens", async () => {
        const ssl = `procedure Node001 begin\n    call combat;\nend\nprocedure talk_p_proc begin\n    call Node001;\nend\n`;
        const data = await parseDialog(ssl);
        const node = data.nodes.find((n) => n.name === "Node001")!;
        // The procedure name token (for rename).
        expect(ssl.slice(node.nameRange!.start, node.nameRange!.end)).toBe("Node001");
        // The intra-node call's target token (for rename / delete-by-call).
        expect(
            ssl.slice(node.callTransitions![0]!.targetRange!.start, node.callTransitions![0]!.targetRange!.end),
        ).toBe("combat");
        // talk_p_proc entry calls: the whole `call Node001;` statement and its target token.
        expect(data.entryCalls).toHaveLength(1);
        expect(ssl.slice(data.entryCalls![0]!.stmtRange.start, data.entryCalls![0]!.stmtRange.end)).toBe(
            "call Node001;",
        );
        expect(ssl.slice(data.entryCalls![0]!.targetRange.start, data.entryCalls![0]!.targetRange.end)).toBe("Node001");
        expect(data.entryCalls![0]!.topLevel).toBe(true); // a direct talk_p_proc body statement (safely removable)
        expect(node.callTransitions![0]!.topLevel).toBe(true); // `call combat;` is a direct Node001 body statement
        // The splice anchor for a NEW entry call: end of talk_p_proc's last body statement.
        expect(data.entryCallAnchor).toBe(data.entryCalls![0]!.stmtRange.end);
    });
});
