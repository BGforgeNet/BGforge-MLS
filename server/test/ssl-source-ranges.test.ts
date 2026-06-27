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
