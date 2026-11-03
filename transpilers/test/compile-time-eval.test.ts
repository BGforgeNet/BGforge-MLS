/**
 * The compile-time evaluator TBAF and TD share (common/compile-time-eval.ts, common/compile-time-value.ts).
 *
 * Every expected value is what TypeScript computes for the same source, or a refusal where the target has no
 * faithful spelling: the evaluator's contract is that a source compiles to what it means or not at all.
 */
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Project, SyntaxKind, type SourceFile } from "ts-morph";
import {
    Scope,
    checkDeclarationKinds,
    declareStatements,
    evaluateCondition,
    unrollFor,
    unrollForOf,
    type Condition,
} from "../common/compile-time-eval";
import { formatArgument, type Value } from "../common/compile-time-value";

// One project for the file: each case only adds a source file to it.
const project = new Project({ useInMemoryFileSystem: true, skipLoadingLibFiles: true });
let fileSeq = 0;

function load(source: string): { file: SourceFile; scope: Scope } {
    const file = project.createSourceFile(`case${fileSeq++}.ts`, source);
    const scope = new Scope();
    declareStatements(scope, file.getStatements());
    return { file, scope };
}

/** The value `result` holds in `source`. */
function valueOf(source: string): Value | undefined {
    const { file, scope } = load(source);
    return scope.lookup("result", file);
}

function int(value: number): Value {
    return { kind: "int", value };
}

/** The condition of the source's last top-level statement, an `if`. */
function conditionOf(source: string): Condition {
    const { file, scope } = load(source);
    const last = file.getStatements().at(-1)?.asKindOrThrow(SyntaxKind.IfStatement);
    if (last === undefined) throw new Error("the case has no statements");
    return evaluateCondition(last.getExpression(), scope);
}

/** A condition with each atom reduced to `name(args)` or `!name(args)`, for comparing shapes. */
function shape(condition: Condition): unknown {
    switch (condition.kind) {
        case "constant":
            return condition.value;
        case "atom":
            return `${condition.negated ? "!" : ""}${condition.name}(${condition.args.map((a) => format(a)).join(",")})`;
        case "and":
            return { and: condition.items.map(shape) };
        case "or":
            return { or: condition.items.map(shape) };
    }
}

function format(value: Value): string {
    const anchor = project.createSourceFile(`anchor${fileSeq++}.ts`, "0;");
    return formatArgument(value, { separator: "," }, anchor);
}

describe("integers", () => {
    it("resolves a constant built from another constant, the way TypeScript does", () => {
        expect(valueOf("const a = 10;\nconst b = a + 1;\nconst result = b * 2;\n")).toEqual(int(22));
    });

    it("reads a constant declared after its use, since a binding is evaluated when read", () => {
        expect(valueOf("const result = later + 1;\nconst later = 4;\n")).toEqual(int(5));
    });

    it("refuses a constant defined in terms of itself", () => {
        expect(() => valueOf("const result = other;\nconst other = result;\n")).toThrow(/defined in terms of itself/);
    });

    it("keeps a hex literal's spelling, and its 32-bit pattern as the value", () => {
        expect(valueOf("const result = 0x10;")).toEqual({ kind: "int", value: 16, text: "0x10" });
        expect(valueOf("const result = 0xFFFFFFFF;")).toEqual({ kind: "int", value: -1, text: "0xFFFFFFFF" });
    });

    it("reads separators and exponents as the integer they spell", () => {
        expect(valueOf("const result = 1_000;")).toEqual(int(1000));
        expect(valueOf("const result = 1e3;")).toEqual(int(1000));
    });

    it("refuses a non-integer literal, which WeiDU cannot read", () => {
        expect(() => valueOf("const result = 1.5;")).toThrow(/1\.5 is not an integer/);
    });

    it("refuses a decimal past 32 bits rather than wrapping it", () => {
        expect(() => valueOf("const result = 2147483648;")).toThrow(/^2147483648 does not fit in 32 bits$/);
    });

    it("reads the smallest 32-bit integer, whose digits alone are out of range", () => {
        expect(valueOf("const result = -2147483648;")).toEqual(int(-2147483648));
    });

    it("folds an exact division", () => {
        expect(valueOf("const a = 10;\nconst result = a / 2;\n")).toEqual(int(5));
    });

    it("refuses a division with a remainder, naming the integer-division forms", () => {
        expect(() => valueOf("const a = 123;\nconst result = a / 2;\n")).toThrow(
            /a \/ 2 is 61\.5, not an integer; write Math\.trunc\(a \/ 2\) or Math\.floor\(a \/ 2\)/,
        );
    });

    it("rounds a quotient the way the named Math function does", () => {
        expect(valueOf("const result = Math.trunc(-7 / 2);")).toEqual(int(-3));
        expect(valueOf("const result = Math.floor(-7 / 2);")).toEqual(int(-4));
        expect(valueOf("const result = Math.ceil(7 / 2);")).toEqual(int(4));
    });

    it("refuses division by zero", () => {
        expect(() => valueOf("const result = 1 / 0;")).toThrow(/division by zero/);
        expect(() => valueOf("const result = 1 % 0;")).toThrow(/division by zero/);
    });

    it("refuses an arithmetic result past 32 bits, and wraps a bitwise one as TypeScript does", () => {
        expect(() => valueOf("const result = 2147483647 + 1;")).toThrow(/does not fit in 32 bits/);
        expect(valueOf("const result = 1 << 31;")).toEqual(int(-2147483648));
        expect(valueOf("const result = 1 | 4;")).toEqual(int(5));
    });

    const operand = fc.integer({ min: -2147483648, max: 2147483647 });
    const operator = fc.constantFrom("+", "-", "*");
    const computed = (a: number, b: number, op: string): number => (op === "+" ? a + b : op === "-" ? a - b : a * b);
    const inRange = (n: number): boolean => n >= -2147483648 && n <= 2147483647;
    const sourceOf = (a: number, b: number, op: string): string =>
        `const a = ${a};\nconst b = ${b};\nconst result = a ${op} b;\n`;

    it("matches TypeScript on every in-range sum, difference and product", () => {
        fc.assert(
            fc.property(operand, operand, operator, (a, b, op) => {
                fc.pre(inRange(computed(a, b, op)));
                expect(valueOf(sourceOf(a, b, op))).toEqual(int(computed(a, b, op)));
            }),
            { numRuns: 200 },
        );
    });

    it("refuses every sum, difference and product past 32 bits", () => {
        fc.assert(
            fc.property(operand, operand, operator, (a, b, op) => {
                fc.pre(!inRange(computed(a, b, op)));
                expect(() => valueOf(sourceOf(a, b, op))).toThrow(/does not fit in 32 bits/);
            }),
            { numRuns: 100 },
        );
    });
});

describe("strings, booleans and choices", () => {
    it("joins strings and integers with + and in a template literal", () => {
        expect(valueOf('const result = "SP" + "WI" + 101;')).toEqual({ kind: "string", value: "SPWI101" });
        expect(valueOf("const n = 7;\nconst result = `SPWI10${n}`;\n")).toEqual({ kind: "string", value: "SPWI107" });
    });

    it("decides a ternary now, never reading the branch it does not take", () => {
        expect(valueOf("const a = 10;\nconst result = a > 5 ? 1 : 1 / 0;\n")).toEqual(int(1));
    });

    it("compares compile-time values", () => {
        expect(valueOf("const a = 3;\nconst result = a === 3 && a !== 4;\n")).toEqual({ kind: "bool", value: true });
    });

    it("short-circuits && and || as TypeScript does, never reading the side that cannot matter", () => {
        expect(valueOf("const result = false && 1 / 0 === 1;")).toEqual({ kind: "bool", value: false });
        expect(valueOf("const result = true || 1 / 0 === 1;")).toEqual({ kind: "bool", value: true });
    });

    it("refuses to compare a value only the game knows", () => {
        expect(() => valueOf('const result = Global("x", "GLOBAL") === 1;')).toThrow(/known only in game/);
    });

    it("refuses an assignment, since a compile-time value cannot change", () => {
        expect(() => valueOf("const a = 1;\nconst result = (a = 2);\n")).toThrow(/cannot change/);
    });
});

describe("arrays and objects", () => {
    it("indexes an array, reads its length, and spreads one into another", () => {
        expect(valueOf("const arr = [100, 200];\nconst result = arr[1];\n")).toEqual(int(200));
        expect(valueOf("const arr = [1, 2];\nconst result = [...arr, 3].length;\n")).toEqual(int(3));
    });

    it("refuses an index outside the array", () => {
        expect(() => valueOf("const arr = [1];\nconst result = arr[3];\n")).toThrow(/index 3 is outside the array/);
    });

    it("reads a field of a constant object, including the compat object an enum becomes", () => {
        expect(valueOf("const cfg = { id: 7 };\nconst result = cfg.id;\n")).toEqual(int(7));
        expect(valueOf("const State = { Idle: 0, Active: 1 } as const;\nconst result = State.Active;\n")).toEqual(
            int(1),
        );
    });

    it("refuses a field the object does not have", () => {
        expect(() => valueOf("const cfg = { id: 7 };\nconst result = cfg.name;\n")).toThrow(/has no field 'name'/);
    });
});

describe("names", () => {
    it("reads an unbound name as the engine's", () => {
        expect(valueOf("const result = Myself;")).toEqual({ kind: "symbol", name: "Myself" });
    });

    it("reads an unbound scope constant as its quoted name", () => {
        expect(valueOf("const result = GLOBAL;")).toEqual({ kind: "string", value: "GLOBAL" });
    });

    it("refuses undefined rather than passing it to the engine as a name", () => {
        expect(() => valueOf("const result = undefined;")).toThrow(/'undefined' has no compile-time value/);
    });

    it("refuses a name declared without a value", () => {
        expect(() => valueOf("declare const x: number;\nlet y;\nconst result = y;\n")).toThrow(
            /declared without a value/,
        );
    });

    it("keeps each function's local constant to that function", () => {
        const source = [
            "function first() {\n    const local = 99;\n    return local;\n}",
            "function second() {\n    const local = 42;\n    return local;\n}",
            "const result = [first(), second()];",
        ].join("\n");
        expect(valueOf(source)).toEqual({ kind: "array", items: [int(99), int(42)] });
    });

    it("lets an inner scope shadow an outer binding without changing it", () => {
        const { file, scope } = load("const v = 1;");
        const inner = scope.child();
        inner.bind("v", int(2));
        expect(inner.lookup("v", file)).toEqual(int(2));
        expect(scope.lookup("v", file)).toEqual(int(1));
    });
});

describe("calls", () => {
    it("builds references with obj, tra, tlk and tlkForced", () => {
        expect(valueOf('const result = obj("[PC]");')).toEqual({ kind: "object", spec: "[PC]" });
        expect(valueOf("const result = $tra(5);")).toEqual({ kind: "strref", ref: { form: "tra", id: 5 } });
        expect(valueOf('const result = tlk(5, { sound: "SND01" });')).toEqual({
            kind: "strref",
            ref: { form: "tlk", id: 5, sound: "SND01" },
        });
        expect(valueOf('const result = tlkForced(9, "text");')).toEqual({
            kind: "strref",
            ref: { form: "tlkForced", id: 9, text: "text" },
        });
    });

    it("treats obj as the reference builder even where the bundle defines it, and never reads that runtime", () => {
        const source = [
            "var ObjectSpec = class {\n    id;\n    constructor(id) {\n        this.id = id;\n    }\n};",
            "function obj(spec) {\n    return new ObjectSpec(spec);\n}",
            'const result = obj("Melicamp");',
        ].join("\n");
        expect(valueOf(source)).toEqual({ kind: "object", spec: "Melicamp" });
    });

    it("inlines a function called for its value, binding its arguments and defaults", () => {
        const source = [
            "function dbl(x: number, by = 2) {\n    const factor = by;\n    return x * factor;\n}",
            "const a = 10;",
            "const result = [dbl(a + 1), dbl(1, 3)];",
        ].join("\n");
        expect(valueOf(source)).toEqual({ kind: "array", items: [int(22), int(3)] });
    });

    it("refuses a value call to a function whose body is not constants and one return", () => {
        expect(() => valueOf("function f() {\n    Attack(Myself);\n}\nconst result = f();\n")).toThrow(
            /'f' is called for its value/,
        );
    });

    it("refuses a call missing an argument with no default", () => {
        expect(() => valueOf("function f(x: number) {\n    return x;\n}\nconst result = f();\n")).toThrow(
            /'f' needs an argument for 'x'/,
        );
    });

    it("keeps an engine call as a call, its arguments evaluated and an array spread among them", () => {
        expect(valueOf("const n = 2;\nconst pair = [n, 3];\nconst result = Foo(Myself, ...pair);\n")).toEqual({
            kind: "call",
            name: "Foo",
            args: [{ kind: "symbol", name: "Myself" }, int(2), int(3)],
        });
    });
});

describe("conditions", () => {
    it("keeps an engine trigger call, negated by !", () => {
        expect(shape(conditionOf("if (!See(Player1)) {}"))).toBe("!See(Player1)");
    });

    it("decides a comparison of constants now, as writing-tbaf.md promises", () => {
        expect(shape(conditionOf("const x = 1;\nif (x > 3) {}\n"))).toBe(false);
    });

    it("folds a constant inside && and ||", () => {
        expect(shape(conditionOf('const a = 1;\nif (Global("g", "GLOBAL", 1) && a === 3) {}\n'))).toBe(false);
        expect(shape(conditionOf('if (Global("g", "GLOBAL", 1) && true) {}'))).toBe('Global("g","GLOBAL",1)');
        expect(shape(conditionOf("if (See(Player1) || true) {}"))).toBe(true);
    });

    it("pushes a negation down to the calls", () => {
        expect(shape(conditionOf("if (!(See(Player1) && See(Player2))) {}"))).toEqual({
            or: ["!See(Player1)", "!See(Player2)"],
        });
    });

    it("reads OR(n, ...) as a group, refusing a count that does not match", () => {
        expect(shape(conditionOf("if (OR(2, See(Player1), See(Player2))) {}"))).toEqual({
            or: ["See(Player1)", "See(Player2)"],
        });
        expect(() => conditionOf("if (OR(3, See(Player1), See(Player2))) {}")).toThrow(/OR\(3, \.\.\.\) groups 2/);
    });

    it("refuses a condition that is neither a trigger call nor a compile-time boolean, where True() used to stand", () => {
        expect(() => conditionOf("if (flag) {}")).toThrow(/not the engine name 'flag'/);
    });

    it("inlines a condition function with its arguments", () => {
        const source = "function sees(who) {\n    return See(who) && !Dead(who);\n}\nif (sees(Player1)) {}\n";
        expect(shape(conditionOf(source))).toEqual({ and: ["See(Player1)", "!Dead(Player1)"] });
    });

    it("refuses a condition function with no top-level return, where True() used to stand", () => {
        const source = "function maybe() {\n    if (See(Player1)) {\n        return true;\n    }\n}\nif (maybe()) {}\n";
        expect(() => conditionOf(source)).toThrow(/'maybe' is called for its value/);
    });
});

describe("loops", () => {
    function forValues(source: string, name: string): (Value | undefined)[] {
        const { file, scope } = load(source);
        const values: (Value | undefined)[] = [];
        const record = (iteration: Scope) => values.push(iteration.lookup(name, file));
        const loop = file.getFirstDescendantByKind(SyntaxKind.ForStatement);
        if (loop) unrollFor(loop, scope, record);
        const forOf = file.getFirstDescendantByKind(SyntaxKind.ForOfStatement);
        if (forOf) unrollForOf(forOf, scope, record);
        return values;
    }

    it("runs a for loop pass by pass, its bound read from a constant", () => {
        expect(forValues("const n = 3;\nfor (let i = 0; i < n; i++) {}\n", "i")).toEqual([int(0), int(1), int(2)]);
        expect(forValues("for (let i = 10; i > 0; i -= 4) {}", "i")).toEqual([int(10), int(6), int(2)]);
    });

    it("refuses a loop that runs past the pass limit", () => {
        expect(() => forValues("for (let i = 0; i >= 0; i++) {}", "i")).toThrow(/runs past 1000 passes/);
    });

    it("refuses an incrementor that updates anything but the counter", () => {
        expect(() => forValues("const j = 0;\nfor (let i = 0; i < 2; j++) {}\n", "i")).toThrow(
            /updates its counter 'i'/,
        );
    });

    it("runs a for...of loop per element, destructuring an array pattern", () => {
        expect(forValues('for (const [a, b] of [["x", 1], ["y", 2]]) {}', "b")).toEqual([int(1), int(2)]);
    });

    it("refuses for...of over something that is not an array", () => {
        expect(() => forValues("for (const x of 5) {}", "x")).toThrow(/runs over an array, not an integer/);
    });
});

describe("declaration kinds", () => {
    function check(source: string): void {
        checkDeclarationKinds(project.createSourceFile(`kinds${fileSeq++}.ts`, source));
    }

    it("refuses let and var outside a loop header", () => {
        expect(() => check("let m = 1;")).toThrow(/'let' declares a value that can change.*use const/);
        expect(() => check("function f() {\n    var x = 1;\n}\n")).toThrow(/'var' declares a value that can change/);
    });

    it("accepts const, a loop counter, and an ambient declaration", () => {
        expect(() =>
            check(
                "const a = 1;\nfor (let i = 0; i < 2; i++) {}\nfor (const x of [1]) {}\ndeclare let ambient: number;\n",
            ),
        ).not.toThrow();
    });
});

describe("argument formatting", () => {
    it("writes each kind the way WeiDU reads it", () => {
        expect(format({ kind: "int", value: 16, text: "0x10" })).toBe("0x10");
        expect(format({ kind: "int", value: -5 })).toBe("-5");
        expect(format({ kind: "string", value: "Player1" })).toBe('"Player1"');
        expect(format({ kind: "string", value: 'say "hi"' })).toBe('~say "hi"~');
        expect(format({ kind: "array", items: [int(2791), int(831)] })).toBe("[2791.831]");
        expect(format({ kind: "strref", ref: { form: "tra", id: 5 } })).toBe("@5");
        expect(format({ kind: "strref", ref: { form: "tlk", id: 5 } })).toBe("5");
        expect(format({ kind: "object", spec: "[PC]" })).toBe("[PC]");
        expect(format({ kind: "object", spec: "Melicamp" })).toBe('"Melicamp"');
        expect(format({ kind: "call", name: "NearestEnemyOf", args: [{ kind: "symbol", name: "Myself" }] })).toBe(
            "NearestEnemyOf(Myself)",
        );
    });

    it("refuses a value WeiDU has no spelling for", () => {
        expect(() => format({ kind: "bool", value: true })).toThrow(/pass 1 or 0/);
        expect(() => format({ kind: "array", items: [int(1), int(2), int(3)] })).toThrow(/exists only at compile time/);
        expect(() => format({ kind: "string", value: `a"b~c` })).toThrow(/both/);
        expect(() => format({ kind: "strref", ref: { form: "tlkForced", id: 1, text: "t" } })).toThrow(/dialog text/);
    });
});
