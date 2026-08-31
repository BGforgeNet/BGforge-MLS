/**
 * Unit tests for the decisions the corpus differential cannot isolate.
 *
 * That differential proves the optimiser matches the reference on 1500 real scripts, which is the real
 * gate - but real scripts do not exercise the cases where a removal would be WRONG, because a script
 * that tripped one would be a broken script nobody shipped. These pin the conservative side: the engine's
 * entry points, an export, and a procedure named through a value the analysis cannot follow.
 *
 * The level-2 suites below pin the transformations one at a time. The differential can only say that a
 * whole script came out identical, so a fold that is wrong in one direction and a removal that is wrong
 * in the other cancel out inside it; each rule here is asserted on its own input instead.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { Language, Parser } from "web-tree-sitter";
import { lowerProgram } from "../src/lower.ts";
import { optimize } from "../src/optimize.ts";
import {
    externalsOf,
    globalsOf,
    proceduresOf,
    type Expr,
    type ProcedureDecl,
    type Program,
    type Stmt,
} from "../src/int/ir.ts";
import { REPO_ROOT } from "../../../shared/cli/test/repo-root.ts";
import { builtArtifactsPresent } from "../../../shared/cli/test/built-artifacts.ts";

const WASM_DIR = path.join(REPO_ROOT, "server/out");
const wasmPresent = builtArtifactsPresent([path.join(WASM_DIR, "tree-sitter-ssl.wasm")], "pnpm build:grammar");

let parser: Parser;

beforeAll(async () => {
    if (!wasmPresent) return;
    await Parser.init({ wasmBinary: fs.readFileSync(path.join(WASM_DIR, "web-tree-sitter.wasm")) });
    parser = new Parser();
    parser.setLanguage(await Language.load(path.join(WASM_DIR, "tree-sitter-ssl.wasm")));
});

const optimized = (source: string, level: 0 | 1 | 2 = 1): Program => {
    const tree = parser.parse(source);
    if (!tree) throw new Error("no tree");
    try {
        return optimize(lowerProgram(tree), { level });
    } finally {
        tree.delete();
    }
};

describe.skipIf(!wasmPresent)("dead-code elimination", () => {
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

/** The named procedure of an optimised program, or a loud failure when the pass removed it. */
function procedureNamed(program: Program, name = "start"): ProcedureDecl {
    const found = proceduresOf(program).find((procedure) => procedure.name === name);
    if (!found) throw new Error(`procedure ${name} did not survive optimisation`);
    return found;
}

/** The body `start` is left with after a full level-2 run. */
function bodyOf(source: string, name = "start"): Stmt[] {
    return procedureNamed(optimized(source, 2), name).body;
}

/**
 * The value a level-2 run leaves in `g := <expression>`. The store is to a GLOBAL, which the dead-store
 * pass does not touch, so folding is the only rule acting on it.
 */
function foldedValue(expression: string): Expr {
    const [statement] = bodyOf(`variable g;\nprocedure start begin g := ${expression}; end\n`);
    if (statement?.kind !== "assign") throw new Error(`expected an assignment, got ${String(statement?.kind)}`);
    return statement.value;
}

const int = (value: number): Extract<Expr, { kind: "int" }> => ({ kind: "int", value });

/** The variables an expression reads, in the order it reads them. */
function varsRead(expr: Expr): string[] {
    switch (expr.kind) {
        case "var":
            return [expr.name];
        case "unary":
            return varsRead(expr.operand);
        case "binary":
            return [...varsRead(expr.left), ...varsRead(expr.right)];
        default:
            return [];
    }
}

/** The surviving assignment to `target`, or a failure naming what was looked for. */
function assignmentTo(body: Stmt[], target: string): Extract<Stmt, { kind: "assign" }> {
    const found = body.find((statement) => statement.kind === "assign" && statement.target.name === target);
    if (found?.kind !== "assign") throw new Error(`no assignment to ${target} survived optimisation`);
    return found;
}

describe.skipIf(!wasmPresent)("level 2 copy propagation", () => {
    /**
     * Folding `a = c` into the statement after it must carry `c` across, not leave the sum reading the
     * slot being written - which nothing has stored to yet. This is the one construct where matching the
     * reference byte for byte at this level would mean reproducing a wrong answer, so the differential
     * cannot pin it and this does; the README's differences table carries the reasoning.
     */
    it("folds a copy forward without losing the value copied", () => {
        const body = bodyOf(
            'procedure start begin\n variable a, b, c;\n a = c;\n a += b;\n display_msg(a + "");\nend\n',
        );

        expect(varsRead(assignmentTo(body, "a").value)).toEqual(["c", "b"]);
    });
});

describe.skipIf(!wasmPresent)("level 2 constant folding", () => {
    it("folds the arithmetic operators bottom-up", () => {
        expect(foldedValue("2 + 3 * 4")).toEqual(int(14));
        expect(foldedValue("10 - 4")).toEqual(int(6));
    });

    it("truncates an integer division toward zero", () => {
        expect(foldedValue("7 / 2")).toEqual(int(3));
        expect(foldedValue("-7 / 2")).toEqual(int(-3));
        expect(foldedValue("7 div 2")).toEqual(int(3));
    });

    it("leaves a division by zero alone rather than folding it", () => {
        // Source cannot reach this - the lowering refuses `1 / 0` outright, as the language does - so the
        // program is built directly. The guard still matters: constant propagation can put a zero into a
        // divisor the source spelled as a variable, and folding it would divide by zero inside the
        // compiler rather than reporting anything.
        const divide: Expr = { kind: "binary", op: "/", left: int(1), right: int(0) };
        const program: Program = {
            declarations: [
                { kind: "global", variable: { name: "g", initial: int(0) } },
                {
                    kind: "procedure",
                    procedure: {
                        name: "start",
                        args: [],
                        locals: [],
                        body: [
                            {
                                kind: "assign",
                                target: { kind: "var", scope: "global", index: 0, name: "g" },
                                op: "=",
                                value: divide,
                            },
                        ],
                    },
                },
            ],
        };
        const optimised = optimize(program, { level: 2 });
        const procedure = procedureNamed(optimised);
        const statement = procedure.body[0];
        if (statement?.kind !== "assign") throw new Error(`expected an assignment, got ${String(statement?.kind)}`);
        expect(statement.value).toEqual(divide);
    });

    it("makes an arithmetic result float when either operand is, and a comparison integer regardless", () => {
        expect(foldedValue("1.5 + 1")).toEqual({ kind: "float", value: 2.5 });
        expect(foldedValue("3.0 / 2")).toEqual({ kind: "float", value: 1.5 });
        expect(foldedValue("1.5 < 2")).toEqual(int(1));
    });

    it("folds a comparison to 1 or 0", () => {
        expect(foldedValue("1 == 1")).toEqual(int(1));
        expect(foldedValue("1 != 1")).toEqual(int(0));
        expect(foldedValue("1 < 2")).toEqual(int(1));
        expect(foldedValue("1 > 2")).toEqual(int(0));
        expect(foldedValue("2 <= 2")).toEqual(int(1));
        expect(foldedValue("1 >= 2")).toEqual(int(0));
    });

    it("folds the bitwise operators", () => {
        expect(foldedValue("6 bwand 3")).toEqual(int(2));
        expect(foldedValue("6 bwor 3")).toEqual(int(7));
        expect(foldedValue("6 bwxor 3")).toEqual(int(5));
    });

    it("folds the unary operators the reference folds", () => {
        expect(foldedValue("not 0")).toEqual(int(1));
        expect(foldedValue("not 5")).toEqual(int(0));
        expect(foldedValue("bwnot 0")).toEqual(int(-1));
        expect(foldedValue("-(5)")).toEqual(int(-5));
        expect(foldedValue("-(1.5)")).toEqual({ kind: "float", value: -1.5 });
    });

    it("leaves `floor` unfolded, which is not in the reference's unary set", () => {
        expect(foldedValue("floor 1.5")).toEqual({
            kind: "unary",
            op: "floor",
            operand: { kind: "float", value: 1.5 },
        });
    });

    it("leaves the operators outside the reference's fold set alone", () => {
        // Folding these was worth 49 scripts' worth of mismatch when it was tried.
        expect(foldedValue("7 % 2")).toEqual({ kind: "binary", op: "%", left: int(7), right: int(2) });
        expect(foldedValue("2 ^ 3")).toEqual({ kind: "binary", op: "^", left: int(2), right: int(3) });
        expect(foldedValue("1 andalso 2")).toEqual({ kind: "binary", op: "andalso", left: int(1), right: int(2) });
        expect(foldedValue("1 orelse 2")).toEqual({ kind: "binary", op: "orelse", left: int(1), right: int(2) });
    });

    it("leaves an expression with a non-constant operand alone", () => {
        const value = foldedValue("random(0, 1) + 1");
        expect(value.kind).toBe("binary");
        expect(foldedValue("not random(0, 1)").kind).toBe("unary");
    });
});

describe.skipIf(!wasmPresent)("level 2 dead code", () => {
    it("replaces a branch whose condition is constantly true with its body", () => {
        const body = bodyOf("variable g;\nprocedure start begin if 1 then g := 3; end\n");
        expect(body.map((statement) => statement.kind)).toEqual(["assign"]);
    });

    it("drops a branch whose condition is constantly false, taking its `else` when there is none", () => {
        expect(bodyOf("variable g;\nprocedure start begin if 0 then g := 3; end\n")).toEqual([]);
    });

    it("keeps the `else` arm of a constantly-false branch", () => {
        const body = bodyOf("variable g;\nprocedure start begin if 0 then g := 3; else g := 4; end\n");
        expect(body).toEqual([
            { kind: "assign", target: { kind: "var", scope: "global", index: 0, name: "g" }, op: "=", value: int(4) },
        ]);
    });

    it("drops a loop whose condition is constantly false", () => {
        expect(bodyOf("variable g;\nprocedure start begin while 0 do g := 3; end\n")).toEqual([]);
    });

    it("keeps a loop whose condition is constantly true, which still runs", () => {
        const body = bodyOf("variable g;\nprocedure start begin while 1 do g := 3; end\n");
        expect(body.map((statement) => statement.kind)).toEqual(["while"]);
    });

    it("drops what follows a statement that always returns", () => {
        const body = bodyOf("variable g;\nprocedure start begin return 1; g := 3; end\n");
        expect(body.map((statement) => statement.kind)).toEqual(["return"]);
    });

    it("keeps an impure condition whose branch emptied out, since it still has to be evaluated", () => {
        // `display_msg` is a statement-position engine call, so the branch body is what empties: the
        // condition itself is a call and cannot be dropped with it.
        const body = bodyOf("procedure start begin if random(0, 1) then begin end end\n");
        expect(body.map((statement) => statement.kind)).toEqual(["if"]);
    });
});

describe.skipIf(!wasmPresent)("level 2 dead stores", () => {
    it("moves a first store's constant into the declaration", () => {
        const program = optimized("procedure start begin variable a := 0; a := 7; return a; end\n", 2);
        const start = procedureNamed(program);
        expect(start.locals.map((local) => local.initial)).toEqual([int(7)]);
        expect(start.body.map((statement) => statement.kind)).toEqual(["return"]);
    });

    it("drops a store a later unconditional store overwrites before any read", () => {
        const source = "procedure start begin variable a; variable b := 5; a := b; a := 9; return a; end\n";
        const start = procedureNamed(optimized(source, 2));
        // `b` goes with the store that read it, and `a`'s surviving constant moves into its declaration.
        expect(start.locals.map((local) => local.name)).toEqual(["a"]);
        expect(start.locals[0]?.initial).toEqual(int(9));
        expect(start.body.map((statement) => statement.kind)).toEqual(["return"]);
    });

    it("drops a last store nothing reads afterwards", () => {
        const source = "variable g := 5;\nprocedure start begin variable a; a := g; end\n";
        const start = procedureNamed(optimized(source, 2));
        expect(start.body).toEqual([]);
        expect(start.locals).toEqual([]);
    });

    it("keeps a store whose value is a call, whatever reads the variable", () => {
        // The call does arbitrary work, so the store stays even though nothing reads what it wrote.
        const body = bodyOf("procedure start begin variable a; a := random(0, 1); end\n");
        expect(body.map((statement) => statement.kind)).toEqual(["assign"]);
    });

    it("keeps a store that is a branch's whole body", () => {
        const body = bodyOf("procedure start begin variable a; if random(0, 1) then a := 1; end\n");
        const [statement] = body;
        expect(statement?.kind).toBe("if");
        if (statement?.kind !== "if") throw new Error("expected the branch to survive");
        expect(statement.thenBranch.kind).toBe("assign");
    });

    it("eats every store to a variable a loop writes and nothing reads after it", () => {
        const body = bodyOf("procedure start begin variable a; while random(0, 1) do a := 1; end\n");
        const [statement] = body;
        if (statement?.kind !== "while") throw new Error("expected the loop to survive");
        expect(statement.body).toEqual({ kind: "block", body: [] });
    });
});

describe.skipIf(!wasmPresent)("level 2 assignment combining", () => {
    it("folds a compound store into the plain store directly before it", () => {
        const body = bodyOf("variable g;\nprocedure start begin g := 1; g += random(0, 1); end\n");
        const [statement] = body;
        if (statement?.kind !== "assign") throw new Error("expected one combined assignment");
        expect(statement.op).toBe("=");
        expect(statement.value.kind).toBe("binary");
        if (statement.value.kind !== "binary") throw new Error("expected the combined value");
        expect(statement.value.op).toBe("+");
        expect(statement.value.left).toEqual(int(1));
    });

    it("leaves stores with anything between them alone", () => {
        const source = "variable g;\nvariable h;\nprocedure start begin g := 1; h := 5; g += random(0, 1); end\n";
        expect(bodyOf(source).map((statement) => statement.kind)).toEqual(["assign", "assign", "assign"]);
    });

    it("does not combine stores to two different imported variables", () => {
        // Externals all carry slot 0 and are told apart by name, so the index alone would fuse these.
        const source = "import variable a;\nimport variable b;\nprocedure start begin a := 1; b += 2; end\n";
        expect(bodyOf(source).map((statement) => statement.kind)).toEqual(["assign", "assign"]);
    });
});

describe.skipIf(!wasmPresent)("level 2 variable and argument slots", () => {
    it("drops a local nothing mentions and renumbers the rest", () => {
        const source = "procedure start begin variable unused; variable used := 3; return used; end\n";
        const start = procedureNamed(optimized(source, 2));
        expect(start.locals.map((local) => local.name)).toEqual(["used"]);
        expect(start.body).toEqual([
            { kind: "return", value: { kind: "var", scope: "local", index: 0, name: "used" } },
        ]);
    });

    it("hands the frame slot of a trailing unread argument to the locals", () => {
        const source = [
            "procedure helper(variable a, variable b);",
            "procedure helper(variable a, variable b) begin",
            "   variable x := 3;",
            "   variable y := 4;",
            "   return a + x + y;",
            "end",
            "procedure start begin return helper(1, 2); end",
            "",
        ].join("\n");
        const helper = procedureNamed(optimized(source, 2), "helper");
        // `b` is never read, so the local block moves down one slot: `x` lands in it and the emitter
        // skips `x`'s initialiser, the caller having already pushed something there. `a` keeps slot 0.
        // Every local survives - the outer loop re-runs this pass, and a round that re-read the block
        // at its declared offset would drop `y` while the body still referenced its slot.
        expect(helper.reclaimedArgSlots).toBe(1);
        expect(helper.locals.map((local) => local.name)).toEqual(["x", "y"]);
        expect(helper.body).toEqual([
            {
                kind: "return",
                value: {
                    kind: "binary",
                    op: "+",
                    left: {
                        kind: "binary",
                        op: "+",
                        left: { kind: "var", scope: "local", index: 0, name: "a" },
                        right: { kind: "var", scope: "local", index: 1, name: "x" },
                    },
                    right: { kind: "var", scope: "local", index: 2, name: "y" },
                },
            },
        ]);
    });

    it("keeps a guarded procedure and the locals its guard reads", () => {
        // The guard is code the engine runs off the procedure table, so nothing needs to call it.
        const source = "variable g;\nprocedure guarded when (g == 1) begin end\nprocedure start begin g := 1; end\n";
        expect(
            proceduresOf(optimized(source, 2))
                .map((procedure) => procedure.name)
                .toSorted(),
        ).toEqual(["guarded", "start"]);
    });
});

describe.skipIf(!wasmPresent)("level 2 traversal of every statement and expression shape", () => {
    it("keeps a store whose value merely contains a call, at any depth", () => {
        const store = (value: string) => bodyOf(`procedure start begin variable a; a := ${value}; end\n`);
        expect(store("1 + random(0, 1)").map((statement) => statement.kind)).toEqual(["assign"]);
        expect(store("not random(0, 1)").map((statement) => statement.kind)).toEqual(["assign"]);
        expect(store("1 if random(0, 1) else 2").map((statement) => statement.kind)).toEqual(["assign"]);
    });

    it("folds inside a conditional expression without collapsing it", () => {
        const [statement] = bodyOf(
            "variable g;\nprocedure start begin g := (1 + 1) if random(0, 1) else (2 + 2); end\n",
        );
        if (statement?.kind !== "assign" || statement.value.kind !== "ternary") {
            throw new Error("expected the conditional to survive");
        }
        expect(statement.value.whenTrue).toEqual(int(2));
        expect(statement.value.whenFalse).toEqual(int(4));
    });

    it("carries a timed call and an engine statement through untouched", () => {
        const source = [
            "procedure later;",
            "procedure later begin end",
            "procedure start begin",
            "   call later in 10;",
            '   display_msg("hi");',
            "end",
            "",
        ].join("\n");
        const program = optimized(source, 2);
        expect(procedureNamed(program).body.map((statement) => statement.kind)).toEqual(["timedCallStmt", "libStmt"]);
        // The timed call is the only reference to `later`, and it has to keep it alive.
        expect(
            proceduresOf(program)
                .map((procedure) => procedure.name)
                .toSorted(),
        ).toEqual(["later", "start"]);
    });

    it("visits a procedure named twice only once", () => {
        const source = [
            "procedure helper;",
            "procedure helper begin end",
            "procedure start begin call helper; call helper; end",
            "",
        ].join("\n");
        expect(
            proceduresOf(optimized(source, 2))
                .map((procedure) => procedure.name)
                .toSorted(),
        ).toEqual(["helper", "start"]);
    });

    it("keeps a local a nested block writes, and drops the store it strands", () => {
        const source = [
            "procedure start begin",
            "   variable a;",
            "   begin a := 1; end",
            "   a := 2;",
            "   display_msg(a);",
            "end",
            "",
        ].join("\n");
        const body = bodyOf(source);
        // The first store is overwritten before any read, so it goes and its now-empty block with it.
        expect(body.map((statement) => statement.kind)).toEqual(["libStmt"]);
        expect(procedureNamed(optimized(source, 2)).locals[0]?.initial).toEqual(int(2));
    });

    it("prunes a removed store's container without disturbing the loop beside it", () => {
        // `removeStatement` rebuilds every container on the way to its target, so a loop and a branch
        // that hold none of it still pass through the rewrite.
        const source = [
            "procedure start begin",
            "   variable a;",
            "   while random(0, 1) do display_msg(1);",
            "   if random(0, 1) then display_msg(2);",
            "   if random(0, 1) then begin display_msg(3); a := 4; end",
            "end",
            "",
        ].join("\n");
        const body = bodyOf(source);
        expect(body.map((statement) => statement.kind)).toEqual(["while", "if", "if"]);
        const last = body.at(-1);
        if (last?.kind !== "if" || last.thenBranch.kind !== "block") throw new Error("expected the branch to survive");
        // Nothing reads `a`, so its store goes while the rest of the branch stays.
        expect(last.thenBranch.body.map((statement) => statement.kind)).toEqual(["libStmt"]);
    });

    it("eats a loop's stores while leaving the branches around them standing", () => {
        const source = [
            "procedure start begin",
            "   variable a;",
            "   if random(0, 1) then display_msg(1);",
            "   while random(0, 1) do begin if random(0, 1) then display_msg(2); a := 3; end",
            "end",
            "",
        ].join("\n");
        const body = bodyOf(source);
        const loop = body.at(-1);
        if (loop?.kind !== "while" || loop.body.kind !== "block") throw new Error("expected the loop to survive");
        expect(loop.body.body.map((statement) => statement.kind)).toEqual(["if"]);
    });

    it("reads a compound store's target before writing it", () => {
        // `a += 2` reads `a`, so the store that produced its value is not dead.
        const body = bodyOf("procedure start begin variable a; a := random(0, 1); a += 2; display_msg(a); end\n");
        expect(body.map((statement) => statement.kind)).toEqual(["assign", "libStmt"]);
    });

    it("keeps a variable a loop assigns twice through a call", () => {
        const source = [
            "procedure start begin",
            "   variable a;",
            "   while random(0, 1) do begin a := random(0, 1); a := random(0, 2); display_msg(a); end",
            "end",
            "",
        ].join("\n");
        const loop = bodyOf(source).at(-1);
        if (loop?.kind !== "while" || loop.body.kind !== "block") throw new Error("expected the loop to survive");
        expect(loop.body.body.map((statement) => statement.kind)).toEqual(["assign", "assign", "libStmt"]);
    });

    it("drops what a bare block returns past", () => {
        const body = bodyOf("variable g;\nprocedure start begin begin return 1; end g := 3; end\n");
        expect(body.map((statement) => statement.kind)).toEqual(["block"]);
    });
});

describe.skipIf(!wasmPresent)("level 2 string table", () => {
    it("keeps only the strings the surviving code still reaches", () => {
        const source = [
            "procedure dead begin",
            '   display_msg("gone");',
            "end",
            "procedure start begin",
            '   variable kept := "local";',
            '   display_msg("used");',
            "   display_msg(kept);",
            "end",
            "",
        ].join("\n");
        // A local's initial value never appears in the body, so a walk of the tree alone would drop
        // "local" and leave the emitter to intern it at the END of the table, shifting every offset.
        expect(optimized(source, 2).stringLiterals).toEqual(["local", "used"]);
    });

    it("interns the name of a procedure passed by name", () => {
        const source = [
            "procedure node998;",
            "procedure node998 begin end",
            "procedure start begin return @node998; end",
            "",
        ].join("\n");
        expect(optimized(source, 2).stringLiterals).toEqual(["node998"]);
    });

    it("keeps a variable's own string value and records that the table existed", () => {
        const source = [
            'variable greeting := "hello";',
            'procedure dead begin display_msg("gone"); end',
            "procedure start begin display_msg(greeting); end",
            "",
        ].join("\n");
        const program = optimized(source, 2);
        expect(program.stringLiterals).toEqual(["hello"]);
        // Emptying a table the script did allocate is not the same as never having had one, and the
        // emitter writes the two apart.
        const emptied = optimized('procedure dead begin display_msg("gone"); end\nprocedure start begin end\n', 2);
        expect(emptied.stringLiterals).toEqual([]);
        expect(emptied.stringTableAllocated).toBe(true);
    });
});

describe.skipIf(!wasmPresent)("level 2 shapes the SSL front end cannot express", () => {
    /** A program of one `start` plus one unreferenced procedure, for the reachability edges. */
    const withDead = (body: Stmt[]): Program => ({
        declarations: [
            { kind: "procedure", procedure: { name: "dead", args: [], locals: [], body: [] } },
            { kind: "procedure", procedure: { name: "start", args: [], locals: [], body } },
        ],
    });

    it("keeps every procedure once a call target is computed at run time", () => {
        // `lookup_string_proc` resolves a name built at run time, so from here on no procedure can be
        // shown unreachable - including one nothing in the source mentions.
        const computed = withDead([
            {
                kind: "callStmt",
                target: { kind: "binary", op: "+", left: { kind: "string", value: "node" }, right: int(998) },
                args: [],
            },
        ]);
        expect(proceduresOf(optimize(computed, { level: 2 })).map((procedure) => procedure.name)).toEqual([
            "dead",
            "start",
        ]);
    });

    it("treats a call through a literal name as a reference to that procedure", () => {
        const named = withDead([{ kind: "callStmt", target: { kind: "string", value: "DEAD" }, args: [] }]);
        // Resolved case-insensitively: the name is matched at load time, not by the source's spelling.
        expect(proceduresOf(optimize(named, { level: 2 })).map((procedure) => procedure.name)).toEqual([
            "dead",
            "start",
        ]);
    });

    it("drops a branch holding nothing but a loop marker, which emits no instruction", () => {
        // Structural emptiness is not the test: a `loopEnd` is a marker the emitter writes nothing for,
        // so a branch holding only one still makes it jump over an arm that is not there. The condition
        // has to be one the fold cannot decide, or the branch is settled before this rule is reached.
        const marker: Program = {
            declarations: [
                {
                    kind: "procedure",
                    procedure: {
                        name: "start",
                        args: [],
                        locals: [{ name: "x", initial: int(0) }],
                        body: [
                            {
                                kind: "if",
                                cond: { kind: "var", scope: "local", index: 0, name: "x" },
                                thenBranch: { kind: "block", body: [{ kind: "loopEnd" }] },
                            },
                        ],
                    },
                },
            ],
        };
        expect(procedureNamed(optimize(marker, { level: 2 })).body).toEqual([]);
    });
});

describe.skipIf(!wasmPresent)("level 2 global constant propagation", () => {
    it("replaces a global nothing assigns with its declared value, then drops it", () => {
        const program = optimized("variable konst := 12;\nprocedure start begin return konst; end\n", 2);
        expect(procedureNamed(program).body).toEqual([{ kind: "return", value: int(12) }]);
        expect(globalsOf(program)).toEqual([]);
    });

    it("leaves a global some procedure assigns alone", () => {
        const source = "variable g := 5;\nprocedure start begin g := 6; return g; end\n";
        const body = bodyOf(source);
        expect(body.at(-1)).toEqual({
            kind: "return",
            value: { kind: "var", scope: "global", index: 0, name: "g" },
        });
    });

    it("leaves a global reached through a call alone", () => {
        // The value is a procedure the engine resolves at run time, not a number to substitute.
        const body = bodyOf("variable g;\nprocedure start begin call g; end\n");
        expect(body).toEqual([
            {
                kind: "callStmt",
                target: { kind: "var", scope: "global", index: 0, name: "g" },
                args: [],
                checkArgCount: true,
            },
        ]);
    });

    it("looks through a branch and a loop for the assignment that disqualifies a global", () => {
        // The walks that collect assignments and call targets recurse into every container; a global
        // written or called only inside one would otherwise look constant.
        const assigned = "variable g := 1;\nprocedure start begin while random(0, 1) do g := 2; return g; end\n";
        expect(bodyOf(assigned).at(-1)).toEqual({
            kind: "return",
            value: { kind: "var", scope: "global", index: 0, name: "g" },
        });
        const called = "variable g;\nprocedure start begin if random(0, 1) then call g; end\n";
        const [branch] = bodyOf(called);
        if (branch?.kind !== "if") throw new Error("expected the branch to survive");
        expect(branch.thenBranch).toEqual({
            kind: "callStmt",
            target: { kind: "var", scope: "global", index: 0, name: "g" },
            args: [],
            checkArgCount: true,
        });
    });

    it("leaves an exported global alone, since another script may assign it", () => {
        const program = optimized("variable g := 5;\nprocedure start begin return g; end\n", 0);
        const exported: Program = {
            ...program,
            declarations: program.declarations.map((declaration) =>
                declaration.kind === "global"
                    ? { kind: "global", variable: { ...declaration.variable, exported: true } }
                    : declaration,
            ),
        };
        expect(procedureNamed(optimize(exported, { level: 2 })).body).toEqual([
            { kind: "return", value: { kind: "var", scope: "global", index: 0, name: "g" } },
        ]);
    });
});
