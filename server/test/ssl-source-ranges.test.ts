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
