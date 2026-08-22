/**
 * Unit tests for inline function extraction and macro generation.
 */

import { describe, expect, it } from "vitest";
import { Project } from "ts-morph";
import { extractInlineFunctions, generateInlineMacros, type InlineFunctionCache } from "../src/inline-functions";
import type { InlineCall, InlineFunc } from "../src/types";

/** One entry of a `generateInlineMacros` fixture, for the common case of a body that is calls. */
function callsFunc(calls: InlineCall[], params: string[] = []): InlineFunc {
    return { body: { kind: "calls", calls }, params };
}

/** The names an extracted function expands to, or `[]` where its body is a bare expression. */
function targetsOf(inline: InlineFunc): string[] {
    return inline.body.kind === "calls" ? inline.body.calls.map((call) => call.targetFunc) : [];
}

describe("generateInlineMacros", () => {
    it("generates basic inline macro without params", () => {
        const inlineFuncs = new Map<string, InlineFunc>([
            [
                "dude_charisma",
                callsFunc([
                    {
                        targetFunc: "get_critter_stat",
                        args: [
                            { type: "constant", value: "dude_obj" },
                            { type: "constant", value: "STAT_ch" },
                        ],
                    },
                ]),
            ],
        ]);
        const used = new Set(["dude_charisma"]);

        const macros = generateInlineMacros(inlineFuncs, used, new Set());
        expect(macros).toEqual(["#define dude_charisma get_critter_stat(dude_obj, STAT_ch)"]);
    });

    it("generates inline macro with params", () => {
        const inlineFuncs = new Map<string, InlineFunc>([
            [
                "set_stat",
                callsFunc(
                    [
                        {
                            targetFunc: "set_critter_stat",
                            args: [
                                { type: "constant", value: "dude_obj" },
                                { type: "param", value: "stat" },
                                { type: "param", value: "val" },
                            ],
                        },
                    ],
                    ["stat", "val"],
                ),
            ],
        ]);
        const used = new Set(["set_stat"]);

        const macros = generateInlineMacros(inlineFuncs, used, new Set());
        expect(macros).toEqual(["#define set_stat(stat, val) set_critter_stat(dude_obj, stat, val)"]);
    });

    it("skips unused inline functions", () => {
        const inlineFuncs = new Map<string, InlineFunc>([
            ["unused_fn", callsFunc([{ targetFunc: "some_func", args: [{ type: "constant", value: "1" }] }])],
        ]);
        const used = new Set<string>();

        const macros = generateInlineMacros(inlineFuncs, used, new Set());
        expect(macros).toEqual([]);
    });

    it("expands enum property access in constant args", () => {
        const inlineFuncs = new Map<string, InlineFunc>([
            [
                "dude_charisma",
                callsFunc([
                    {
                        targetFunc: "get_critter_stat",
                        args: [
                            { type: "constant", value: "dude_obj" },
                            { type: "constant", value: "STAT.ch" },
                        ],
                    },
                ]),
            ],
        ]);
        const used = new Set(["dude_charisma"]);
        const enumNames = new Set(["STAT"]);

        const macros = generateInlineMacros(inlineFuncs, used, enumNames);
        expect(macros).toEqual(["#define dude_charisma get_critter_stat(dude_obj, STAT_ch)"]);
    });

    it("expands multiple enum accesses in same arg list", () => {
        const inlineFuncs = new Map<string, InlineFunc>([
            [
                "multi_enum",
                callsFunc(
                    [
                        {
                            targetFunc: "some_func",
                            args: [
                                { type: "constant", value: "STAT.ch" },
                                { type: "constant", value: "SKILL.lockpick" },
                                { type: "param", value: "x" },
                            ],
                        },
                    ],
                    ["x"],
                ),
            ],
        ]);
        const used = new Set(["multi_enum"]);
        const enumNames = new Set(["STAT", "SKILL"]);

        const macros = generateInlineMacros(inlineFuncs, used, enumNames);
        expect(macros).toEqual(["#define multi_enum(x) some_func(STAT_ch, SKILL_lockpick, x)"]);
    });

    it("does not modify param args even if they look like enums", () => {
        const inlineFuncs = new Map<string, InlineFunc>([
            ["fn", callsFunc([{ targetFunc: "target", args: [{ type: "param", value: "STAT.ch" }] }], ["STAT.ch"])],
        ]);
        const used = new Set(["fn"]);
        const enumNames = new Set(["STAT"]);

        const macros = generateInlineMacros(inlineFuncs, used, enumNames);
        // Param args should not be transformed
        expect(macros).toEqual(["#define fn(STAT.ch) target(STAT.ch)"]);
    });

    it("does not expand property access for non-enum names", () => {
        const inlineFuncs = new Map<string, InlineFunc>([
            ["fn", callsFunc([{ targetFunc: "target", args: [{ type: "constant", value: "obj.prop" }] }])],
        ]);
        const used = new Set(["fn"]);
        const enumNames = new Set(["STAT"]);

        const macros = generateInlineMacros(inlineFuncs, used, enumNames);
        // obj is not an enum name, so it should remain as-is
        expect(macros).toEqual(["#define fn target(obj.prop)"]);
    });

    it("parenthesises an expression body so it cannot re-associate at the splice", () => {
        // Measured, not assumed: `a := m + 1` against a bare body compiles to different bytes from the
        // wrapped one - SSL reads `metarule(46, 0) != 0 + 1` as a comparison against `0 + 1`. A call
        // body is atomic and stays bare, which is why only this shape is wrapped.
        const inlineFuncs = new Map<string, InlineFunc>([
            [
                "map_first_run",
                {
                    body: { kind: "expression", value: "metarule(46, 0) != 0", source: "metarule(46, 0) != 0" },
                    params: [],
                },
            ],
        ]);

        const macros = generateInlineMacros(inlineFuncs, new Set(["map_first_run"]), new Set());
        expect(macros).toEqual(["#define map_first_run (metarule(46, 0) != 0)"]);
    });

    it("joins a multi-call macro body with semicolons", () => {
        // What the reference compiler accepts for a body of several statements: `begin ... end` is
        // refused in this position, a semicolon-separated sequence is not.
        const inlineFuncs = new Map<string, InlineFunc>([
            [
                "greet",
                callsFunc(
                    [
                        { targetFunc: "debug_msg", args: [{ type: "constant", value: '"first"' }] },
                        { targetFunc: "debug_msg", args: [{ type: "param", value: "who" }] },
                    ],
                    ["who"],
                ),
            ],
        ]);

        const macros = generateInlineMacros(inlineFuncs, new Set(["greet"]), new Set());
        expect(macros).toEqual(['#define greet(who) debug_msg("first"); debug_msg(who)']);
    });

    it("handles empty enum names set", () => {
        const inlineFuncs = new Map<string, InlineFunc>([
            ["fn", callsFunc([{ targetFunc: "target", args: [{ type: "constant", value: "STAT.ch" }] }])],
        ]);
        const used = new Set(["fn"]);

        const macros = generateInlineMacros(inlineFuncs, used, new Set());
        // No enum names, so no expansion
        expect(macros).toEqual(["#define fn target(STAT.ch)"]);
    });
});

describe("extractInlineFunctions", () => {
    function sourceFrom(code: string) {
        const project = new Project({ useInMemoryFileSystem: true });
        return project.createSourceFile("/lib.ts", code);
    }

    it("takes a returned expression as the body when it is not a call", () => {
        // folib's `map_first_run` shape. It compiled as a procedure because only a call was accepted.
        const source = sourceFrom(
            [
                "/** @inline */",
                "export function map_first_run(): boolean {",
                "    return metarule(46, 0) != 0;",
                "}",
                "",
            ].join("\n"),
        );
        const inline = extractInlineFunctions(source).get("map_first_run");
        expect(inline).toBeDefined();
        expect(inline!.body).toEqual({
            kind: "expression",
            value: "metarule(46, 0) != 0",
            source: "metarule(46, 0) != 0",
        });
    });

    it("does not wrap an expression body the author already parenthesised", () => {
        const source = sourceFrom(
            [
                "/** @inline */",
                "export function map_first_run(): boolean {",
                "    return (metarule(46, 0) != 0);",
                "}",
                "",
            ].join("\n"),
        );
        const inline = extractInlineFunctions(source).get("map_first_run");
        expect(inline).toBeDefined();
        // Stored unwrapped, so the layer emission adds is the only one - `((...))` otherwise, and a
        // redundant pair is not always inert in SSL.
        expect(inline!.body).toEqual({
            kind: "expression",
            value: "metarule(46, 0) != 0",
            source: "metarule(46, 0) != 0",
        });
    });

    it("sees the call through a chain of type assertions", () => {
        // folib's `inven_count` returns `critter_inven_obj(...) as unknown as number` - two assertions,
        // so peeling one leaves another and the call is never found.
        const source = sourceFrom(
            [
                "/** @inline */",
                "export function inven_count(who: number): number {",
                "    return critter_inven_obj(who, 1) as unknown as number;",
                "}",
                "",
            ].join("\n"),
        );
        const inline = extractInlineFunctions(source).get("inven_count");
        expect(inline).toBeDefined();
        expect(targetsOf(inline!)).toEqual(["critter_inven_obj"]);
    });

    it("extracts an @inline function's target call and parameters", () => {
        const source = sourceFrom(
            [
                "/**",
                " * Logs a message to debug.log.",
                " * @param msg log message",
                " * @inline",
                " */",
                "export function ndebug(msg: string): void {",
                '    debug_msg(SCRIPT_REALNAME + ": " + msg);',
                "}",
                "",
            ].join("\n"),
        );
        const result = extractInlineFunctions(source);
        expect(result.has("ndebug")).toBe(true);
        const inline = result.get("ndebug")!;
        expect(targetsOf(inline)).toEqual(["debug_msg"]);
        expect(inline.params).toEqual(["msg"]);
    });

    it("leaves a tagged function whose body is not calls or a returned value to be a procedure", () => {
        // The fallback the tag has always had: a body a macro cannot stand for compiles as an ordinary
        // procedure rather than failing. Control flow is outside every expandable shape.
        const source = sourceFrom(
            "/** @inline */\nexport function loud(n: number): void {\n    for (let i = 0; i < n; i++) display_msg(i);\n}\n",
        );
        expect(extractInlineFunctions(source).size).toBe(0);
    });

    it("leaves a tagged function alone when a statement precedes the returned call", () => {
        // The macro can only stand for the call, so expanding one out of a longer body would drop
        // everything else in it - silently, since both front ends read this same extraction.
        const source = sourceFrom(
            [
                "/** @inline */",
                "export function guarded(x: number): number {",
                '    debug_msg("first");',
                "    return sfall_func1(x);",
                "}",
                "",
            ].join("\n"),
        );
        expect(extractInlineFunctions(source).size).toBe(0);
    });

    it("extracts every call of a tagged void function, not just the first", () => {
        const source = sourceFrom(
            [
                "/** @inline */",
                "export function greet(who: string): void {",
                '    debug_msg("first");',
                "    debug_msg(who);",
                "}",
                "",
            ].join("\n"),
        );
        const inline = extractInlineFunctions(source).get("greet");
        expect(inline).toBeDefined();
        expect(targetsOf(inline!)).toEqual(["debug_msg", "debug_msg"]);
        expect(inline!.body).toMatchObject({ calls: [{}, { args: [{ type: "param", value: "who" }] }] });
    });

    it("answers from the cache without re-walking a file already seen", () => {
        const cache: InlineFunctionCache = new Map();
        const source = sourceFrom("/** @inline */\nexport function f(): void {\n    g();\n}\n");
        const first = extractInlineFunctions(source, cache);
        expect(first.has("f")).toBe(true);
        // The cached entry is returned as-is, so the same map instance comes back.
        expect(extractInlineFunctions(source, cache)).toBe(first);
    });
});
