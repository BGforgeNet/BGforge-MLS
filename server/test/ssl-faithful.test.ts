import { describe, expect, it } from "vitest";
import { parseDialog } from "../src/dialog";

const wrap = (body: string) =>
    `procedure Node001 begin\n${body}\nend\nprocedure talk_p_proc begin\n  call Node001;\nend\n`;

describe("SSL faithful predicate", () => {
    const faithfulOf = async (body: string) => {
        const r = await parseDialog(wrap(body));
        return r.nodes.find((n) => n.name === "Node001")?.faithful;
    };

    it("a flat sequence of dialog calls is faithful", async () => {
        expect(await faithfulOf(`  Reply(100);\n  NOption(101, Node002, 4);`)).toBe(true);
    });

    it("a single-level if wrapping dialog calls is faithful", async () => {
        expect(await faithfulOf(`  if (global_var(GVAR_X) == 1) then NOption(101, Node002, 4);`)).toBe(true);
    });

    it("an else branch is NOT faithful", async () => {
        expect(
            await faithfulOf(
                `  if (global_var(GVAR_X) == 1) then NOption(101, Node002, 4) else NOption(102, Node003, 4);`,
            ),
        ).toBe(false);
    });

    it("a loop is NOT faithful", async () => {
        expect(await faithfulOf(`  while (game_time < 10) do begin Reply(100); end`)).toBe(false);
    });

    it("a variable assignment interleaved with dialog calls is NOT faithful", async () => {
        expect(await faithfulOf(`  Reply(100);\n  some_var := 1;\n  NOption(101, Node002, 4);`)).toBe(false);
    });
});
