/**
 * Constant arithmetic must be folded before it reaches an emitted mod file.
 *
 * `SetGlobal("g", "GLOBAL", 1 + 333)` is not valid BAF - an argument is an operand, not an expression -
 * and the repo's own grammar says so, which is what the .tbaf cases assert against rather than a string
 * match. The transpiler has no constant-folding pass of its own, so today whether an expression
 * survives to the mod file is decided entirely by the bundler's optimiser: a same-module binding gets
 * substituted and folded, while `optimization.inlineConst: false` keeps an IMPORTED one whole, and the
 * imported case reaches the file as `10 + 1`.
 *
 * Relying on that is the defect. The fold belongs in `applyHelperFixups`, the one last-mile pass both
 * languages share - TBAF reaches it per argument through `fixupArgs`, TD per whole rendered action
 * string - so the result holds whichever bundler is underneath and whichever granularity the caller
 * uses. `inlineConst` cannot simply be enabled instead: it also folds `const LOCALS = "LOCALS"` into a
 * string literal the emitter then double-quotes (`""LOCALS""`), invalid in 3 of the 13 real mod files.
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { initParser, parseWithCache } from "../../shared/parsers/weidu-baf";
import { transpile } from "../src/index";
import { REPO_ROOT } from "./repo-root";

const FIXTURE = path.join(REPO_ROOT, "transpilers/test/fixtures/constant-folding");

beforeAll(async () => {
    await initParser();
});

/** Transpile one fixture entry and hand back the emitted mod file. */
async function emit(entryName: string): Promise<string> {
    const entry = path.join(FIXTURE, entryName);
    const result = await transpile(entry, fs.readFileSync(entry, "utf-8"));
    return result.output as string;
}

/**
 * Match one emitted SetGlobal by its variable and folded value, tolerating the separator spacing.
 * BAF renders `SetGlobal("x", "GLOBAL", 11)` and D renders `SetGlobal("x","GLOBAL",11)`; the fold owes
 * the VALUE, and pinning either emitter's whitespace here would assert something it never promised.
 */
function setsGlobalTo(emitted: string, name: string, value: number): boolean {
    return new RegExp(`SetGlobal\\("${name}",\\s*"GLOBAL",\\s*${value}\\)`).test(emitted);
}

describe("constant folding in emitted mod files", () => {
    describe("BAF, one argument at a time through fixupArgs", () => {
        it("folds arithmetic on an imported enum member", async () => {
            const emitted = await emit("script.tbaf");

            expect(setsGlobalTo(emitted, "imported_enum", 11)).toBe(true);
        });

        it("folds arithmetic on an imported const", async () => {
            const emitted = await emit("script.tbaf");

            expect(setsGlobalTo(emitted, "imported_const", 6)).toBe(true);
        });

        it("folds arithmetic on a locally declared enum member", async () => {
            const emitted = await emit("script.tbaf");

            expect(setsGlobalTo(emitted, "local_enum", 334)).toBe(true);
        });

        it("emits BAF the grammar accepts", async () => {
            const emitted = await emit("script.tbaf");

            const tree = parseWithCache(emitted);
            expect(tree).toBeDefined();
            // The positive control for this assertion is the fixture itself: before the fold existed,
            // this same file parsed with an error, because `10 + 1` is not an argument.
            expect(tree!.rootNode.hasError).toBe(false);
        });
    });

    describe("D, whole rendered action strings through applyHelperFixups", () => {
        it("folds arithmetic on an imported enum member", async () => {
            const emitted = await emit("dialog.td");

            expect(setsGlobalTo(emitted, "imported_enum", 11)).toBe(true);
        });

        it("folds arithmetic on an imported const", async () => {
            const emitted = await emit("dialog.td");

            expect(setsGlobalTo(emitted, "imported_const", 6)).toBe(true);
        });
    });
});
