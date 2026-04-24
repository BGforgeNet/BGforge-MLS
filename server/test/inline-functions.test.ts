/**
 * Unit tests for inline function extraction, macro generation,
 * and enum constant tree-shaking helpers.
 */

import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { Project } from "ts-morph";
import { generateInlineMacros, extractInlineFunctionsFromFiles } from "../../transpilers/tssl/src/inline-functions";
import { isEnumConstant, collectReferencedIdentifiers } from "../../transpilers/tssl/src/emit";
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

describe("isEnumConstant", () => {
    const enumNames = new Set(["STAT", "SKILL"]);

    it("returns true for enum-generated constant", () => {
        expect(isEnumConstant("STAT_ch", enumNames)).toBe(true);
        expect(isEnumConstant("SKILL_lockpick", enumNames)).toBe(true);
    });

    it("returns false for non-enum constant", () => {
        expect(isEnumConstant("MAX_HP", enumNames)).toBe(false);
        expect(isEnumConstant("SCRIPT_REALNAME", enumNames)).toBe(false);
    });

    it("returns false for name without underscore", () => {
        expect(isEnumConstant("STAT", enumNames)).toBe(false);
        expect(isEnumConstant("foo", enumNames)).toBe(false);
    });

    it("returns false with empty enum names", () => {
        expect(isEnumConstant("STAT_ch", new Set())).toBe(false);
    });

    it("handles enum names with underscores", () => {
        const names = new Set(["DAMAGE_TYPE"]);
        expect(isEnumConstant("DAMAGE_TYPE_Fire", names)).toBe(true);
        expect(isEnumConstant("DAMAGE_TYPE_Laser", names)).toBe(true);
        // Prefix "DAMAGE" alone is not an enum name
        expect(isEnumConstant("DAMAGE_resist", names)).toBe(false);
    });
});

describe("collectReferencedIdentifiers", () => {
    function makeSourceFile(code: string) {
        const project = new Project({ useInMemoryFileSystem: true });
        return project.createSourceFile("test.ts", code);
    }

    it("collects identifiers from source file", () => {
        const sf = makeSourceFile("const x = foo(bar);");
        const ids = collectReferencedIdentifiers(sf, []);
        expect(ids.has("foo")).toBe(true);
        expect(ids.has("bar")).toBe(true);
        expect(ids.has("x")).toBe(true);
    });

    it("collects identifiers from define strings", () => {
        const sf = makeSourceFile("");
        const defines = ["#define dude_ch get_critter_stat(dude_obj, STAT_ch)"];
        const ids = collectReferencedIdentifiers(sf, defines);
        expect(ids.has("STAT_ch")).toBe(true);
        expect(ids.has("dude_obj")).toBe(true);
    });

    it("collects from both source file and defines", () => {
        const sf = makeSourceFile("const x = STAT_ch + 1;");
        const defines = ["#define fn target(SKILL_lockpick)"];
        const ids = collectReferencedIdentifiers(sf, defines);
        expect(ids.has("STAT_ch")).toBe(true);
        expect(ids.has("SKILL_lockpick")).toBe(true);
    });

    it("returns empty set for empty inputs", () => {
        const sf = makeSourceFile("");
        const ids = collectReferencedIdentifiers(sf, []);
        expect(ids.size).toBe(0);
    });

    it("does not include identifiers not present in either source", () => {
        const sf = makeSourceFile("const x = 1;");
        const ids = collectReferencedIdentifiers(sf, []);
        expect(ids.has("STAT_ch")).toBe(false);
        expect(ids.has("foo")).toBe(false);
    });
});

describe("extractInlineFunctionsFromFiles", () => {
    const tmpDir = path.resolve("tmp/server-test-inline");

    function writeTmpFile(name: string, content: string): string {
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
        const filePath = path.join(tmpDir, name);
        fs.writeFileSync(filePath, content, "utf-8");
        return filePath;
    }

    function cleanTmpDir() {
        if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
    }

    it("extracts @inline function from file given absolute path", () => {
        try {
            const filePath = writeTmpFile(
                "utils.ts",
                `
/**
 * Logs a message to debug.log.
 * @param msg log message
 * @inline
 */
export function ndebug(msg: string): void {
    debug_msg(SCRIPT_REALNAME + ": " + msg);
}
`,
            );
            const project = new Project();
            const result = extractInlineFunctionsFromFiles(project, [filePath]);
            expect(result.has("ndebug")).toBe(true);
            const inline = result.get("ndebug")!;
            expect(inline.targetFunc).toBe("debug_msg");
            expect(inline.params).toEqual(["msg"]);
        } finally {
            cleanTmpDir();
        }
    });

    it("skips files that do not exist", () => {
        const project = new Project();
        const result = extractInlineFunctionsFromFiles(project, ["/nonexistent/file.ts"]);
        expect(result.size).toBe(0);
    });

    it("skips relative paths that cannot be resolved from cwd", () => {
        try {
            // Simulate the bug: esbuild metafile returns paths relative to absWorkingDir,
            // which differs from process.cwd(). The relative path won't resolve.
            const filePath = writeTmpFile(
                "lib.ts",
                `
/** @inline */
export function foo(): void { bar(); }
`,
            );
            const project = new Project();
            // Use a path relative to tmpDir, not cwd — this simulates the absWorkingDir mismatch
            const relativePath = path.relative(tmpDir, filePath);

            // From cwd, this relative path doesn't resolve to the actual file
            // (unless cwd happens to equal tmpDir)
            const fromCwd = path.resolve(process.cwd(), relativePath);
            const existsFromCwd = fs.existsSync(fromCwd);

            if (!existsFromCwd) {
                // This is the bug scenario: relative path doesn't work from cwd
                const result = extractInlineFunctionsFromFiles(project, [relativePath]);
                expect(result.size).toBe(0);
            }

            // But absolute path always works
            const result = extractInlineFunctionsFromFiles(project, [filePath]);
            expect(result.has("foo")).toBe(true);
        } finally {
            cleanTmpDir();
        }
    });
});
