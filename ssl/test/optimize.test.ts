/**
 * Unit tests for the decisions the corpus differential cannot isolate.
 *
 * That differential proves the optimiser matches the reference on 1500 real scripts, which is the real
 * gate - but real scripts do not exercise the cases where a removal would be WRONG, because a script
 * that tripped one would be a broken script nobody shipped. These pin the conservative side: the engine's
 * entry points, an export, and a procedure named through a value the analysis cannot follow.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { Language, Parser } from "web-tree-sitter";
import { lowerProgram } from "../src/lower.ts";
import { optimize } from "../src/optimize.ts";
import { externalsOf, globalsOf, proceduresOf, type Program } from "../src/int/ir.ts";
import { REPO_ROOT } from "../../shared/cli/test/repo-root.ts";

const WASM_DIR = path.join(REPO_ROOT, "server/out");
const wasmPresent = fs.existsSync(path.join(WASM_DIR, "tree-sitter-ssl.wasm"));

describe.skipIf(!wasmPresent)("dead-code elimination", () => {
    let parser: Parser;

    beforeAll(async () => {
        await Parser.init({ wasmBinary: fs.readFileSync(path.join(WASM_DIR, "web-tree-sitter.wasm")) });
        parser = new Parser();
        parser.setLanguage(await Language.load(path.join(WASM_DIR, "tree-sitter-ssl.wasm")));
    });

    const optimized = (source: string, level: 0 | 1 = 1): Program => {
        const tree = parser.parse(source);
        if (!tree) throw new Error("no tree");
        try {
            return optimize(lowerProgram(tree), { level });
        } finally {
            tree.delete();
        }
    };
    const names = (program: Program) => proceduresOf(program).map((p) => p.name);

    it("removes a procedure nothing reaches", () => {
        const source = "procedure dead begin end\nprocedure start begin end\n";
        expect(names(optimized(source))).toEqual(["start"]);
    });

    it("keeps a procedure the engine calls by name", () => {
        // Nothing in the script references it; the engine dispatches on the name alone.
        const source = "procedure look_at_p_proc begin end\nprocedure start begin end\n";
        expect(names(optimized(source)).toSorted()).toEqual(["look_at_p_proc", "start"]);
    });

    it("keeps the Fallout 1 spelling of an entry point", () => {
        // `desc_p_proc` is Fallout 1's `description_p_proc`. It cannot appear in the Fallout 2 corpus,
        // so only the reference compiler's protected list says it must survive - deleting it would
        // silently strip the description handler out of every Fallout 1 script.
        const source = "procedure desc_p_proc begin end\nprocedure start begin end\n";
        expect(names(optimized(source)).toSorted()).toEqual(["desc_p_proc", "start"]);
    });

    it("keeps an exported procedure", () => {
        const source = "procedure start begin end\n";
        const program = optimized(source);
        const withExport: Program = {
            ...program,
            declarations: [
                { kind: "procedure", procedure: { name: "shared", args: [], locals: [], body: [], exported: true } },
                ...program.declarations,
            ],
        };
        expect(names(optimize(withExport, { level: 1 })).toSorted()).toEqual(["shared", "start"]);
    });

    it("follows a chain of calls and stops at what nothing reaches", () => {
        const source = [
            "procedure a;",
            "procedure b;",
            "procedure c;",
            "procedure a begin call b; end",
            "procedure b begin end",
            "procedure c begin end",
            "procedure start begin call a; end",
            "",
        ].join("\n");
        expect(names(optimized(source)).toSorted()).toEqual(["a", "b", "start"]);
    });

    it("keeps a procedure only ever named as a value", () => {
        // The Node-dispatch pattern: the slot is stored, then called through the variable later.
        const source = [
            "procedure node998;",
            "procedure node998 begin end",
            "procedure start begin",
            "   variable p := node998;",
            "   call p;",
            "end",
            "",
        ].join("\n");
        expect(names(optimized(source)).toSorted()).toEqual(["node998", "start"]);
    });

    it("removes a global nothing reads", () => {
        const source = "variable used;\nvariable unused;\nprocedure start begin used := 1; end\n";
        expect(globalsOf(optimized(source)).map((v) => v.name)).toEqual(["used"]);
    });

    it("keeps an exported variable, which another script reads by name", () => {
        // `export variable` is an EXTERNAL carrying the export bit, not a global - the export is the
        // definition other scripts import, so nothing in this file needs to mention it.
        const source = "export variable shared := 1;\nprocedure start begin end\n";
        expect(externalsOf(optimized(source)).map((v) => v.name)).toEqual(["shared"]);
    });

    it("drops an import the script never mentions", () => {
        const source = "import variable used;\nimport variable never;\nprocedure start begin used := 1; end\n";
        expect(externalsOf(optimized(source)).map((v) => v.name)).toEqual(["used"]);
    });

    it("drops a global whose only reader was itself removed", () => {
        const source = "variable only_dead;\nprocedure dead begin only_dead := 1; end\nprocedure start begin end\n";
        expect(globalsOf(optimized(source))).toEqual([]);
    });

    it("leaves everything alone at level 0", () => {
        const source = "variable unused;\nprocedure dead begin end\nprocedure start begin end\n";
        const program = optimized(source, 0);
        expect(names(program).toSorted()).toEqual(["dead", "start"]);
        expect(globalsOf(program).map((v) => v.name)).toEqual(["unused"]);
    });

    it("keeps a declared-but-undefined procedure's complaint only while it survives", () => {
        // Dead: the emitter never sees it, so there is nothing left to refuse.
        expect(optimized("procedure ghost;\nprocedure start begin end\n").undefinedProcedures).toBeUndefined();
        // Reachable: the complaint has to survive, renumbered with everything else.
        const live = optimized("procedure ghost;\nprocedure start begin call ghost; end\n");
        expect(live.undefinedProcedures?.map((u) => u.name)).toEqual(["ghost"]);
    });
});
