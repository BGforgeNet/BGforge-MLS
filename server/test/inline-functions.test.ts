/**
 * Unit tests for inline function extraction and macro generation.
 */

import { describe, expect, it } from "vitest";
import { Project } from "ts-morph";
import {
    extractInlineFunctions,
    generateInlineMacros,
    type InlineFunctionCache,
} from "../../transpilers/tssl/src/inline-functions";
import type { InlineFunc } from "../../transpilers/tssl/src/types";

describe("generateInlineMacros", () => {
    it("generates basic inline macro without params", () => {
        const inlineFuncs = new Map<string, InlineFunc>([
            [
                "dude_charisma",
                {
                    targetFunc: "get_critter_stat",
                    args: [
                        { type: "constant", value: "dude_obj" },
                        { type: "constant", value: "STAT_ch" },
                    ],
                    params: [],
                },
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
                {
                    targetFunc: "set_critter_stat",
                    args: [
                        { type: "constant", value: "dude_obj" },
                        { type: "param", value: "stat" },
                        { type: "param", value: "val" },
                    ],
                    params: ["stat", "val"],
                },
            ],
        ]);
        const used = new Set(["set_stat"]);

        const macros = generateInlineMacros(inlineFuncs, used, new Set());
        expect(macros).toEqual(["#define set_stat(stat, val) set_critter_stat(dude_obj, stat, val)"]);
    });

    it("skips unused inline functions", () => {
        const inlineFuncs = new Map<string, InlineFunc>([
            [
                "unused_fn",
                {
                    targetFunc: "some_func",
                    args: [{ type: "constant", value: "1" }],
                    params: [],
                },
            ],
        ]);
        const used = new Set<string>();

        const macros = generateInlineMacros(inlineFuncs, used, new Set());
        expect(macros).toEqual([]);
    });

    it("expands enum property access in constant args", () => {
        const inlineFuncs = new Map<string, InlineFunc>([
            [
                "dude_charisma",
                {
                    targetFunc: "get_critter_stat",
                    args: [
                        { type: "constant", value: "dude_obj" },
                        { type: "constant", value: "STAT.ch" },
                    ],
                    params: [],
                },
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
                {
                    targetFunc: "some_func",
                    args: [
                        { type: "constant", value: "STAT.ch" },
                        { type: "constant", value: "SKILL.lockpick" },
                        { type: "param", value: "x" },
                    ],
                    params: ["x"],
                },
            ],
        ]);
        const used = new Set(["multi_enum"]);
        const enumNames = new Set(["STAT", "SKILL"]);

        const macros = generateInlineMacros(inlineFuncs, used, enumNames);
        expect(macros).toEqual(["#define multi_enum(x) some_func(STAT_ch, SKILL_lockpick, x)"]);
    });

    it("does not modify param args even if they look like enums", () => {
        const inlineFuncs = new Map<string, InlineFunc>([
            [
                "fn",
                {
                    targetFunc: "target",
                    args: [{ type: "param", value: "STAT.ch" }],
                    params: ["STAT.ch"],
                },
            ],
        ]);
        const used = new Set(["fn"]);
        const enumNames = new Set(["STAT"]);

        const macros = generateInlineMacros(inlineFuncs, used, enumNames);
        // Param args should not be transformed
        expect(macros).toEqual(["#define fn(STAT.ch) target(STAT.ch)"]);
    });

    it("does not expand property access for non-enum names", () => {
        const inlineFuncs = new Map<string, InlineFunc>([
            [
                "fn",
                {
                    targetFunc: "target",
                    args: [{ type: "constant", value: "obj.prop" }],
                    params: [],
                },
            ],
        ]);
        const used = new Set(["fn"]);
        const enumNames = new Set(["STAT"]);

        const macros = generateInlineMacros(inlineFuncs, used, enumNames);
        // obj is not an enum name, so it should remain as-is
        expect(macros).toEqual(["#define fn target(obj.prop)"]);
    });

    it("handles empty enum names set", () => {
        const inlineFuncs = new Map<string, InlineFunc>([
            [
                "fn",
                {
                    targetFunc: "target",
                    args: [{ type: "constant", value: "STAT.ch" }],
                    params: [],
                },
            ],
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
        expect(inline.targetFunc).toBe("debug_msg");
        expect(inline.params).toEqual(["msg"]);
    });

    it("leaves a tagged function whose body is not a single call to be a procedure", () => {
        // folib relies on this: map_first_run is tagged @inline but returns a comparison, and has
        // always shipped as a real procedure.
        const source = sourceFrom(
            "/** @inline */\nexport function map_first_run(): boolean {\n    return metarule(46, 0) != 0;\n}\n",
        );
        expect(extractInlineFunctions(source).size).toBe(0);
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
