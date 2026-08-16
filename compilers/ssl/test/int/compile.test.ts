/**
 * End-to-end differential: SSL source text through the whole pipeline, byte-compared against the
 * reference compiler.
 *
 * `emit.test.ts` drives the emitter from hand-built IR, which isolates codegen but encodes this file's
 * assumptions about what the front end produces. This one starts from source, so it is the test that
 * can catch a lowering that builds the wrong tree - the two are complements, not duplicates.
 *
 * Needs the grammar WASM (a build) and the reference compiler (an optional dependency); skips without
 * either, with the case count asserted so a skip cannot read as a pass.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Language, Parser } from "web-tree-sitter";
import { compileFile } from "../../src/compile.ts";
import { REPO_ROOT } from "../../../../shared/cli/test/repo-root.ts";
import { SPAWN_TIMEOUT_MS } from "../../../../shared/spawn-timeout.ts";

const WASM_DIR = path.join(REPO_ROOT, "server/out");

function findCompiler(): string | null {
    try {
        return createRequire(path.join(REPO_ROOT, "server/package.json")).resolve(
            "sslc-emscripten-noderawfs/compiler.mjs",
        );
    } catch {
        return null;
    }
}

const compiler = findCompiler();
const wasmPresent = fs.existsSync(path.join(WASM_DIR, "tree-sitter-ssl.wasm"));
const workDir = compiler && wasmPresent ? fs.mkdtempSync(path.join(os.tmpdir(), "ssl-e2e-")) : "";

afterAll(() => {
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
});

interface Case {
    name: string;
    source: string;
}

const CASES: Case[] = [
    { name: "empty procedure", source: "procedure start begin end\n" },
    { name: "arithmetic assignment", source: "procedure start begin\n variable x;\n x := 1 + 2;\nend\n" },
    {
        name: "if with else",
        source: "procedure start begin\n variable x;\n if (x) then begin\n  x := 1;\n end else begin\n  x := 2;\n end\nend\n",
    },
    {
        name: "while with compound assignment",
        source: "procedure start begin\n variable x;\n while (x < 10) do begin\n  x += 1;\n end\nend\n",
    },
    { name: "global variable", source: "variable g := 3;\nprocedure start begin\n g := 4;\nend\n" },
    { name: "engine call as a statement", source: 'procedure start begin\n display_msg("hi");\nend\n' },
    {
        name: "engine call in an expression",
        source: "procedure start begin\n variable x;\n x := random(1, 10);\nend\n",
    },
    {
        name: "procedure call",
        source: "procedure foo;\nprocedure foo begin end\nprocedure start begin\n call foo;\nend\n",
    },
    {
        name: "procedure call with arguments",
        source:
            "procedure foo(variable a);\nprocedure foo(variable a) begin end\n" +
            "procedure start begin\n call foo(5);\nend\n",
    },
    { name: "return with a value", source: "procedure start begin\n return 7;\nend\n" },
    { name: "string local", source: 'procedure start begin\n variable s := "hi";\nend\n' },
    { name: "exported variable", source: "export variable g := 1;\nprocedure start begin end\n" },
    {
        name: "nested arithmetic",
        source: "procedure start begin\n variable a;\n variable b;\n a := (b + 1) * 2 - 3;\nend\n",
    },
    { name: "unary operators", source: "procedure start begin\n variable x;\n x := -(not x);\nend\n" },
    {
        name: "for loop",
        source: "procedure start begin\n variable i;\n for (i := 0; i < 3; i += 1) begin\n  i := i;\n end\nend\n",
    },
    {
        name: "for loop declaring its variable",
        source: "procedure start begin\n for (variable i := 0; i < 3; i += 1) begin\n  i := i;\n end\nend\n",
    },
    {
        // Expands to an indexed while loop over generated temporaries; their allocation order fixes
        // both the `tmp.<n>` names in the name table and the local slot indices.
        name: "foreach over a variable",
        source: "procedure start begin\n variable a;\n variable v;\n foreach v in a begin\n  v := v;\n end\nend\n",
    },
    {
        name: "foreach over an expression needs a temporary",
        source: "procedure start begin\n variable v;\n foreach v in load_array(1) begin\n  v := v;\n end\nend\n",
    },
    {
        name: "foreach with key and value",
        source: "procedure start begin\n variable a;\n variable k;\n variable v;\n foreach k: v in a begin\n  v := k;\n end\nend\n",
    },
    {
        name: "switch over a variable",
        source:
            "procedure start begin\n variable x;\n switch x begin\n  case 1: x := 10;\n" +
            "  case 2: x := 20;\n  default: x := 30;\n end\nend\n",
    },
    {
        name: "switch over an expression needs a temporary",
        source: "procedure start begin\n variable x;\n switch (x + 1) begin\n  case 1: x := 10;\n end\nend\n",
    },
    {
        name: "switch with no default",
        source: "procedure start begin\n variable x;\n switch x begin\n  case 1: x := 10;\n  case 2: x := 20;\n end\nend\n",
    },
    {
        // Built by summing engine calls, not by a dedicated instruction.
        name: "array literal",
        source: "procedure start begin\n variable a;\n a := [1, 2, 3];\nend\n",
    },
    {
        name: "empty array literal",
        source: "procedure start begin\n variable a;\n a := [];\nend\n",
    },
    {
        name: "map literal",
        source: 'procedure start begin\n variable m;\n m := {"a": 1, "b": 2};\nend\n',
    },
    {
        // A nested literal is flagged and terminated so the engine's expression stack unwinds.
        name: "nested array literal",
        source: "procedure start begin\n variable a;\n a := [1, [2, 3]];\nend\n",
    },
    {
        name: "array subscript and member access",
        source: "procedure start begin\n variable a;\n variable x;\n x := a[1];\n x := a.field;\nend\n",
    },
    {
        // `andalso`/`orelse` short-circuit even though this file compiles without the pragma.
        name: "explicitly short-circuiting operators",
        source: "procedure start begin\n variable x;\n x := (x andalso 1) orelse 2;\nend\n",
    },
    {
        // A bare procedure name calls it; `@name` would yield its index instead.
        name: "bare procedure name calls it",
        source: "procedure foo begin\n return 1;\nend\nprocedure start begin\n variable x;\n x := foo;\nend\n",
    },
    {
        name: "integer division and exponentiation",
        source: "procedure start begin\n variable x;\n x := (7 div 2) + (2 ^ 3);\nend\n",
    },
    {
        // A bare return is not a void return: the language supplies zero.
        name: "bare return returns zero",
        source: "procedure foo(variable a) begin\n if a == 0 then return;\n a := 1;\nend\nprocedure start begin end\n",
    },
    {
        // Increment and decrement are compound assignment spelled differently, and an array element
        // steps the same way - down to the temporary a complex index needs.
        name: "increment and decrement statements",
        source: "procedure start begin\n variable x;\n variable a;\n x++;\n x--;\n a[1]++;\n a[x + 1]--;\n a.b++;\nend\n",
    },
    {
        // `pure` and `inline` are recorded in the procedure table, not just advisory to the reader.
        name: "procedure modifiers reach the table",
        source: "pure procedure foo begin end\ninline procedure bar begin end\nprocedure start begin end\n",
    },
    {
        name: "continue inside a for loop",
        source: "procedure start begin\n variable i;\n for (i := 0; i < 3; i += 1) begin\n  continue;\n end\nend\n",
    },
    {
        // The guard is ANDed into the loop's bounds test, so it is checked before every iteration
        // rather than being a second loop. Parentheses around the head change nothing.
        name: "foreach with a while guard",
        source: [
            "procedure start begin",
            "   variable a;",
            "   variable i;",
            "   foreach variable v in a while (i < 3) begin i += 1; end",
            // `variable` appears once for the head, not once per name.
            "   foreach (variable k: w in a while (i < 5)) begin i += 1; end",
            "end",
        ].join("\n"),
    },
    {
        // The callee may be a string: the engine resolves the name at run time, so the call carries an
        // argument-count check rather than a resolved procedure slot.
        name: "a string names the procedure to call",
        source: 'procedure start begin\n variable x;\n x := "foo"(1);\n x := "bar"();\nend\n',
    },
    {
        // The process-control statements: child scripts, suspension, event cancellation and critical
        // sections. `cancelall` emits its opcode twice, which is the reference's own duplication.
        name: "process control statements",
        source: [
            "procedure foo;",
            "procedure foo begin",
            "   wait(50);",
            "   detach;",
            "end",
            "procedure start begin",
            "   startcritical;",
            '   spawn("child");',
            '   callstart("other");',
            '   exec("third");',
            '   fork("fourth");',
            "   cancel(foo);",
            "   cancelall;",
            "   noop;",
            "   endcritical;",
            "   exit;",
            "end",
        ].join("\n"),
    },
    {
        // An engine function that takes nothing is called without parentheses, which is a statement form
        // of its own rather than a bare value.
        name: "engine call without parentheses",
        source: "procedure start begin\n refresh_pc_art;\n game_ui_disable;\nend\n",
    },
    {
        // `variable a[10]` both declares the slot and fills it with a fresh array, so a declaration that
        // looks inert emits code. The flags argument is optional and defaults to 4.
        name: "array declarations create their array",
        source: "procedure start begin\n variable a[10];\n variable b[4, 2];\n a[0] := b[1];\nend\n",
    },
    {
        // A global initialiser is a constant expression, not just a literal: one unary operator folds
        // into the slot, and `not`/`bwnot` make it an integer whatever they were given.
        name: "unary operators fold into a global initialiser",
        source: "variable g := not 0;\nvariable h := bwnot 5;\nvariable i := ((-7));\nprocedure start begin\n g := g + h + i;\nend\n",
    },
    {
        // A parameter default is the same constant expression a global initialiser is, and the negated
        // form is how a script spells an "unset" sentinel. The parentheses may wrap the whole constant
        // but not the operand - `-(7)` is refused, which `lower.test.ts` pins alongside this.
        name: "a negated parameter default reaches the call",
        source:
            "procedure p(variable a = -1, variable b = ((-7)));\n" +
            'procedure p(variable a, variable b) begin\n display_msg("x");\nend\n' +
            "procedure start begin\n call p;\nend\n",
    },
    {
        // Two literals written next to each other are one string, as in C.
        name: "adjacent string literals concatenate",
        source: 'procedure start begin\n variable s := "ab" "cd"\n   "ef";\nend\n',
    },
    {
        // A character constant is an integer. The octal form spells its leading zero as a marker: `\0`
        // then two or three digits, so `\0101` is 65 and `\101` is not a character constant at all.
        name: "character constants are integers",
        source: "procedure start begin\n variable a := 'A';\n variable b := '\\n';\n variable c := '\\0101';\nend\n",
    },
    {
        // The escape table decides string-table BYTES, so the reference is the only oracle for it that
        // cannot be satisfied by agreeing with our own reading. `\v` in particular yields a horizontal
        // tab, which no corpus script spells and this compiler got wrong until it was compared here.
        name: "string escapes reach the string table",
        source: 'procedure start begin\n variable s := "a\\ab\\bc\\fd\\ne\\rf\\tg\\vh\\\\i\\"j\\zk";\nend\n',
    },
    {
        // The pragma turns short-circuit evaluation on for the whole program, so it is placed AFTER the
        // operators it governs: a compiler that acted on it where it sits would agree on any other
        // placement. Without it these bytes are the plain form, which is what made the miss silent.
        name: "a trailing #pragma sce short-circuits the whole program",
        source:
            "procedure start begin\n variable a;\n variable b;\n variable c;\n" +
            " if (a and b) then c := 1;\n if (a or b) then c := 2;\nend\n#pragma sce\n",
    },
    {
        // A pragma sits in statement position as readily as at the top, and an unknown one is carried
        // through the parse and dropped rather than refused.
        name: "an unknown pragma inside a procedure is ignored",
        source: "procedure start begin\n variable a;\n#pragma somethingelse\n a := 1;\nend\n",
    },
    {
        // Every keyword here appears zero times in the 1525-script corpus, so the differential that
        // sweeps it cannot say whether any of them is right. They are grouped into one case because
        // what is being pinned is that the grammar reaches them at all.
        name: "keywords no corpus script uses",
        source:
            "pure procedure helper begin\n return 1;\nend\n" +
            "inline procedure inl begin\n end\n" +
            "procedure start begin\n variable a := 5;\n variable b;\n" +
            " noop;\n detach;\n startcritical;\n endcritical;\n" +
            " spawn(1);\n callstart(2);\n exec(3);\n fork(4);\n wait(50);\n" +
            " b := a andalso 1;\n b := a orelse 1;\n b := a div 2;\n b := bwnot a;\n" +
            " call inl;\n b := helper();\nend\n",
    },
];

describe.skipIf(compiler === null || !wasmPresent)("SSL source compiles to matching bytecode", () => {
    let parser: Parser;

    beforeAll(async () => {
        await Parser.init({ wasmBinary: fs.readFileSync(path.join(WASM_DIR, "web-tree-sitter.wasm")) });
        parser = new Parser();
        parser.setLanguage(await Language.load(path.join(WASM_DIR, "tree-sitter-ssl.wasm")));
    });

    it("covers every case in the table", () => {
        expect(CASES.length).toBeGreaterThanOrEqual(28);
    });

    it.each(CASES)("$name", ({ name, source }) => {
        compareWithReference(parser, name, source, 0);
    });

    it.each(OPTIMIZED_CASES)("$name at -O2", ({ name, source }) => {
        compareWithReference(parser, name, source, 2);
    });
});

/**
 * Cases for the optimised differential. The corpus sweep in `test/integration` compares whole real
 * scripts at every level, but only over the shapes real scripts happen to contain - a hand-written case
 * is the only way to reach the rest, and it runs here rather than there because it needs no checkout.
 */
const OPTIMIZED_CASES: Case[] = [
    {
        // `cancel` names a procedure, and that name is the only thing keeping it alive: without counting
        // the reference, the optimiser removes the procedure and cancels something that is no longer there.
        name: "cancel keeps the procedure it names",
        source: "procedure foo;\nprocedure foo begin end\nprocedure start begin\n cancel(foo);\n cancelall;\nend\n",
    },
    {
        // A trailing argument nothing reads gives its slot to the first local, and the optimiser's
        // outer loop then re-reads the local block - at its new offset, not the declared one. Reading
        // it at the old offset dropped `y` while the body still referenced its slot, and the emitter
        // wrote one initialiser too few.
        name: "locals after an argument slot is reclaimed",
        source:
            "procedure helper(variable a, variable b);\n" +
            "procedure helper(variable a, variable b) begin\n" +
            " variable x := 3;\n variable y := 4;\n return a + x + y;\nend\n" +
            "procedure start begin\n return helper(1, 2);\nend\n",
    },
    {
        // `pure` exists to let this store go: nothing reads `x`, and the modifier is the author promising
        // the call does nothing else. Treating every call as impure kept it, which no corpus script could
        // reveal - not one of the 1525 declares a pure procedure.
        name: "a dead store fed by a pure procedure goes",
        source: "pure procedure helper begin\n return 1;\nend\nprocedure start begin\n variable x;\n x := helper();\nend\n",
    },
    {
        // The same for the engine functions that only compute. All five are here rather than one: they
        // are recognised by looking their names up in the engine table, so a name that stopped resolving
        // would silently drop out of the set and cost nothing but this comparison.
        name: "a dead store fed by a pure engine function goes",
        source:
            'procedure start begin\n variable s := "5";\n variable a;\n variable x;\n' +
            // `modified_ini` takes no arguments, so it is written without parentheses.
            " x := atoi(s);\n x := atof(s);\n x := len_array(a);\n x := get_tile_fid(1);\n x := modified_ini;\nend\n",
    },
    {
        // The callee being pure does not excuse the arguments: `random` still has to run.
        name: "a pure call with an impure argument stays",
        source: 'procedure start begin\n variable x;\n x := atoi("5" + random(1, 2));\nend\n',
    },
];

function compareWithReference(parser: Parser, name: string, source: string, level: 0 | 2): void {
    const stem = `${name.replaceAll(/\W+/g, "_")}_O${level}`;
    const file = path.join(workDir, `${stem}.ssl`);
    fs.writeFileSync(file, source);
    // These sources go to the reference RAW, so it needs `-p` to preprocess them at all - without it a
    // case carrying a directive would compare our expansion against a source whose directives were dropped.
    const args = [compiler as string, `-O${level}`, "-q", "-p", `${stem}.ssl`, "-o", `${stem}.int`];
    execFileSync(process.execPath, args, {
        cwd: workDir,
        timeout: SPAWN_TIMEOUT_MS,
    });
    const expected = new Uint8Array(fs.readFileSync(path.join(workDir, `${stem}.int`)));
    const actual = compileFile(parser, file, { level });
    expect([...actual], `ref ${expected.length} bytes, ours ${actual.length}`).toEqual([...expected]);
}
