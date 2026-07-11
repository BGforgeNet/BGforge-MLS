import { describe, expect, it } from "vitest";
import { parseDialog } from "../src/dialog";

const wrap = (body: string) =>
    `procedure Node001 begin\n${body}\nend\nprocedure talk_p_proc begin\n  call Node001;\nend\n`;

async function bundleFaithfulOf(body: string): Promise<boolean> {
    const src = `procedure Node001 begin\n${body}\nend\nprocedure talk_p_proc begin call Node001; end\n`;
    const data = await parseDialog(src);
    return data.nodes.find((n) => n.name === "Node001")?.bundleFaithful === true;
}

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

describe("bundleFaithful gate", () => {
    it("an if/else of dialog calls + a side-effect is bundle-faithful", async () => {
        expect(
            await bundleFaithfulOf(
                `if (local_var(LVAR_0) == 0) then begin set_local_var(LVAR_0,1); Reply(120); NOption(122, Node915, 4); end else begin Reply(121); NOption(124, Node915, 4); end`,
            ),
        ).toBe(true);
    });
    it("a plain faithful node (no else, only dialog calls) is NOT bundleFaithful", async () => {
        expect(await bundleFaithfulOf(`Reply(100); NOption(101, Node002, 4);`)).toBe(false);
    });
    it("a nested if is NOT bundle-faithful", async () => {
        expect(
            await bundleFaithfulOf(
                `if (global_var(GVAR_X) == 1) then begin if (global_var(GVAR_Y) == 1) then Reply(1); end`,
            ),
        ).toBe(false);
    });
    it("a loop in a branch is NOT bundle-faithful", async () => {
        expect(await bundleFaithfulOf(`if (game_time < 10) then begin while (1) do begin Reply(1); end end`)).toBe(
            false,
        );
    });
    it("a top-level dialog call beside an if is NOT bundle-faithful (slice 1: body is only ifs)", async () => {
        expect(
            await bundleFaithfulOf(
                `Reply(1); if (global_var(GVAR_X) == 1) then begin Reply(2); end else begin Reply(3); end`,
            ),
        ).toBe(false);
    });
});
