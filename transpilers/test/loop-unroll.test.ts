/**
 * Compile-time loop unroll guard tests for TBAF and TD.
 *
 * These drive the real transpile() entry points (not the internal unroll
 * functions) so the assertions keep holding across the tbaf/loop-unroll.ts
 * <-> td/inline-and-unroll.ts unification and after their extraction into a
 * shared transpilers/common core.
 */
import { describe, expect, it } from "vitest";
import { transpile as tbafTranspile } from "../tbaf/src/index";
import { transpile as tdTranspile } from "../td/src/index";

describe("loop unroll: multi-variable for-initializer", () => {
    it("TBAF rejects a for loop with more than one variable in its initializer", async () => {
        const src = `for (let i = 0, j = 0; i < 3; i++) {\n    Continue();\n}\n`;
        await expect(tbafTranspile("/virtual/foo.tbaf", src)).rejects.toMatchObject({
            name: "TranspileError",
            message: "Cannot unroll for loop: multi-variable initializer",
        });
    });

    it("TD rejects a for loop with more than one variable in its initializer", async () => {
        const src = [
            "function start() {",
            "    say(tra(1));",
            "    for (let i = 0, j = 0; i < 3; i++) {",
            "        reply(tra(2));",
            "        exit();",
            "    }",
            "}",
            "",
            'export default begin("MYDLG", [start]);',
            "",
        ].join("\n");
        await expect(tdTranspile("/virtual/foo.td", src)).rejects.toMatchObject({
            name: "TranspileError",
            message: "Cannot unroll for loop: multi-variable initializer",
        });
    });
});
