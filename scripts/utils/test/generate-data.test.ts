/**
 * Tests for generate-data module: completion, hover, and signature generation
 * from YAML data files.
 */

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WEIDU_TP2_STANZAS } from "../../../shared/stanza-names.ts";
import {
    generateCompletion,
    generateHover,
    generateSignatures,
    getDetail,
    loadData,
} from "../src/generate-data.ts";

const TMP_BASE = "tmp";
beforeAll(() => fs.mkdirSync(TMP_BASE, { recursive: true }));

describe("getDetail", () => {
    it("returns typed signature for item with args", () => {
        const item = {
            name: "my_func",
            type: "int",
            args: [
                { name: "a", type: "int", doc: "first" },
                { name: "b", type: "ObjectPtr", doc: "second" },
            ],
        };
        expect(getDetail(item)).toBe("int my_func(int a, ObjectPtr b)");
    });

    it("returns untyped signature when includeTypes is false", () => {
        const item = {
            name: "my_func",
            type: "int",
            args: [{ name: "a", type: "int", doc: "first" }],
        };
        expect(getDetail(item, false)).toBe("my_func(a)");
    });

    it("returns detail field when no args", () => {
        const item = { name: "my_func", detail: "void my_func()" };
        expect(getDetail(item)).toBe("void my_func()");
    });

    it("returns name when no args and no detail", () => {
        const item = { name: "my_keyword" };
        expect(getDetail(item)).toBe("my_keyword");
    });
});

describe("loadData", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(TMP_BASE, ".gen-test-"));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true });
    });

    it("loads a single YAML file", () => {
        const yaml = `stanza1:\n  type: 3\n  items:\n    - name: func1\n`;
        fs.writeFileSync(path.join(tmpDir, "a.yml"), yaml, "utf8");
        const data = loadData([path.join(tmpDir, "a.yml")]);
        expect(data["stanza1"]).toBeDefined();
        expect(data["stanza1"]!.items).toHaveLength(1);
    });

    it("merges multiple YAML files (last-writer-wins)", () => {
        const y1 = `s1:\n  type: 1\n  items:\n    - name: a\n`;
        const y2 = `s1:\n  type: 2\n  items:\n    - name: b\ns2:\n  type: 3\n  items:\n    - name: c\n`;
        fs.writeFileSync(path.join(tmpDir, "a.yml"), y1, "utf8");
        fs.writeFileSync(path.join(tmpDir, "b.yml"), y2, "utf8");
        const data = loadData([path.join(tmpDir, "a.yml"), path.join(tmpDir, "b.yml")]);
        // s1 overwritten by b.yml
        expect(data["s1"]!.type).toBe(2);
        // s2 from b.yml
        expect(data["s2"]).toBeDefined();
    });

    it("sorts stanzas and item names alphabetically after loading", () => {
        const yaml = `zeta:\n  type: 3\n  items:\n    - name: zed\n    - name: alpha\nalpha:\n  type: 14\n  items:\n    - name: zulu\n    - name: beta\n`;
        fs.writeFileSync(path.join(tmpDir, "a.yml"), yaml, "utf8");
        const data = loadData([path.join(tmpDir, "a.yml")]);
        expect(Object.keys(data)).toEqual(["alpha", "zeta"]);
        expect(data["alpha"]!.items.map((item) => item.name)).toEqual(["beta", "zulu"]);
        expect(data["zeta"]!.items.map((item) => item.name)).toEqual(["alpha", "zed"]);
    });
});

describe("generateCompletion", () => {
    it("generates basic completion items", () => {
        const data = {
            keywords: { type: 14, items: [{ name: "begin" }] },
        };
        const result = generateCompletion(data, "test-lang");
        expect(result).toHaveLength(1);
        expect(result[0]!.label).toBe("begin");
        expect(result[0]!.kind).toBe(14);
        expect(result[0]!.source).toBe("builtin");
        expect(result[0]!.category).toBe("keywords");
    });

    it("includes documentation when detail differs from name", () => {
        const data = {
            funcs: { type: 3, items: [{ name: "foo", detail: "void foo()" }] },
        };
        const result = generateCompletion(data, "test-lang");
        expect(result[0]!.documentation).toBeDefined();
        expect(result[0]!.documentation!.kind).toBe("markdown");
        expect(result[0]!.documentation!.value).toContain("void foo()");
    });

    it("skips documentation when label equals detail and no doc", () => {
        const data = {
            kw: { type: 14, items: [{ name: "begin" }] },
        };
        const result = generateCompletion(data, "test-lang");
        expect(result[0]!.documentation).toBeUndefined();
    });

    it("includes documentation when doc is present even if detail equals name", () => {
        const data = {
            kw: { type: 14, items: [{ name: "begin", doc: "Start a block." }] },
        };
        const result = generateCompletion(data, "test-lang");
        expect(result[0]!.documentation).toBeDefined();
        expect(result[0]!.documentation!.value).toContain("Start a block.");
    });

    it("adds deprecated tag", () => {
        const data = {
            old: { type: 3, items: [{ name: "old_func", deprecated: true }] },
        };
        const result = generateCompletion(data, "test-lang");
        expect(result[0]!.tags).toEqual([1]);
    });

    it("does not add tags when not deprecated", () => {
        const data = {
            kw: { type: 14, items: [{ name: "x" }] },
        };
        const result = generateCompletion(data, "test-lang");
        expect(result[0]!.tags).toBeUndefined();
    });

    it("generates documentation for items with args", () => {
        const data = {
            funcs: {
                type: 3,
                items: [{
                    name: "f",
                    type: "int",
                    args: [{ name: "a", type: "int", doc: "val" }],
                }],
            },
        };
        const result = generateCompletion(data, "lang");
        expect(result[0]!.documentation!.value).toContain("int f(int a)");
        expect(result[0]!.documentation!.value).toContain("|`a`|&nbsp;&nbsp;val|");
    });

    it("uses category override instead of stanza name when set", () => {
        const data = {
            patch_byte: { type: 3, category: "patch", items: [{ name: "READ_BYTE" }] },
        };
        const result = generateCompletion(data, "lang");
        expect(result[0]!.category).toBe("patch");
    });

    it("emits completion entries sorted by stanza and item name", () => {
        const data = {
            zeta: { type: 3, items: [{ name: "zed" }, { name: "alpha" }] },
            alpha: { type: 14, items: [{ name: "zulu" }, { name: "beta" }] },
        };
        const result = generateCompletion(data, "lang");
        expect(result.map((item) => `${item.category}:${item.label}`)).toEqual([
            "alpha:beta",
            "alpha:zulu",
            "zeta:alpha",
            "zeta:zed",
        ]);
    });
});

describe("generateHover", () => {
    it("generates hover for items with detail", () => {
        const data = {
            funcs: { type: 3, items: [{ name: "foo", detail: "void foo()" }] },
        };
        const result = generateHover(data, "lang");
        expect(result["foo"]).toBeDefined();
        expect(result["foo"]!.contents.value).toContain("void foo()");
    });

    it("skips items with only a name", () => {
        const data = {
            kw: { type: 14, items: [{ name: "begin" }] },
        };
        const result = generateHover(data, "lang");
        expect(result["begin"]).toBeUndefined();
    });

    it("includes doc in hover", () => {
        const data = {
            funcs: { type: 3, items: [{ name: "foo", doc: "Does stuff." }] },
        };
        const result = generateHover(data, "lang");
        expect(result["foo"]!.contents.value).toContain("Does stuff.");
    });

    it("generates hover for items with args", () => {
        const data = {
            funcs: {
                type: 3,
                items: [{
                    name: "f",
                    type: "int",
                    args: [{ name: "x", type: "int", doc: "val" }],
                    doc: "A function.",
                }],
            },
        };
        const result = generateHover(data, "lang");
        expect(result["f"]!.contents.value).toContain("int f(int x)");
    });

    it("merges hover for same-name items across stanzas", () => {
        const data = {
            actions: { type: 3, items: [{ name: "Help", detail: "Help()", doc: "Action doc." }] },
            triggers: { type: 3, items: [{ name: "Help", detail: "Help(O:Object*)", doc: "Trigger doc." }] },
        };
        const result = generateHover(data, "lang");
        expect(result["Help"]).toBeDefined();
        const value = result["Help"]!.contents.value;
        expect(value).toContain("Help()");
        expect(value).toContain("Help(O:Object*)");
        expect(value).toContain("Action doc.");
        expect(value).toContain("Trigger doc.");
        expect(value).toContain("---");
    });

    it("emits hover object keys in sorted order", () => {
        const data = {
            zeta: { type: 3, items: [{ name: "zed", detail: "zed()" }, { name: "alpha", detail: "alpha()" }] },
            alpha: { type: 3, items: [{ name: "zulu", detail: "zulu()" }, { name: "beta", detail: "beta()" }] },
        };
        const result = generateHover(data, "lang");
        expect(Object.keys(result)).toEqual(["beta", "zulu", "alpha", "zed"]);
    });
});

describe("generateCompletion detail propagation", () => {
    it("adds detail for duplicated labels across stanzas", () => {
        const data = {
            actions: { type: 3, items: [{ name: "Help", detail: "Help()" }] },
            triggers: { type: 3, items: [{ name: "Help", detail: "Help(O:Object*)" }] },
        };
        const result = generateCompletion(data, "test-lang");
        const helpItems = result.filter((r) => r.label === "Help");
        expect(helpItems).toHaveLength(2);
        for (const item of helpItems) {
            expect(item.detail).toBeDefined();
        }
    });

    it("omits detail for unique labels even when detail differs from label", () => {
        const data = {
            actions: { type: 3, items: [{ name: "Continue", detail: "Continue()" }] },
        };
        const result = generateCompletion(data, "test-lang");
        expect(result[0]!.detail).toBeUndefined();
    });
});

// -- WeiDU-format tests --

describe("getDetail (WeiDU)", () => {
    it("returns 'type function NAME' for WeiDU item with args", () => {
        const item = {
            name: "SUBSTRING",
            type: "dimorphic",
            args: [{ name: "start", type: "int" }],
        };
        expect(getDetail(item)).toBe("dimorphic function SUBSTRING");
    });

    it("returns 'patch function NAME' for patch type", () => {
        const item = {
            name: "MY_FUNC",
            type: "patch",
            args: [{ name: "x", type: "int" }],
        };
        expect(getDetail(item)).toBe("patch function MY_FUNC");
    });

    it("returns just name when includeTypes is false", () => {
        const item = {
            name: "SUBSTRING",
            type: "dimorphic",
            args: [{ name: "start", type: "int" }],
        };
        expect(getDetail(item, false)).toBe("SUBSTRING");
    });

    it("returns name for WeiDU item with rets only (no item.type)", () => {
        const item = {
            name: "GET_INDEX",
            rets: [{ name: "index", type: "int" }],
        };
        expect(getDetail(item)).toBe("GET_INDEX");
    });
});

describe("getDetail (stanza prefix)", () => {
    it("prepends callable prefix from stanza name", () => {
        const item = { name: "HANDLE_AUDIO" };
        expect(getDetail(item, true, WEIDU_TP2_STANZAS.action_functions)).toBe("action function HANDLE_AUDIO");
    });

    it("prepends patch function prefix", () => {
        const item = { name: "ADD_AREA_ITEM" };
        expect(getDetail(item, true, WEIDU_TP2_STANZAS.patch_functions)).toBe("patch function ADD_AREA_ITEM");
    });

    it("prepends dimorphic function prefix", () => {
        const item = { name: "RESOLVE_STR_REF" };
        expect(getDetail(item, true, WEIDU_TP2_STANZAS.dimorphic_functions)).toBe("dimorphic function RESOLVE_STR_REF");
    });

    it("prepends action macro prefix", () => {
        const item = { name: "READ_SOUNDSET" };
        expect(getDetail(item, true, WEIDU_TP2_STANZAS.action_macros)).toBe("action macro READ_SOUNDSET");
    });

    it("prepends patch macro prefix", () => {
        const item = { name: "tb_factorial" };
        expect(getDetail(item, true, WEIDU_TP2_STANZAS.patch_macros)).toBe("patch macro tb_factorial");
    });

    it("does not double-prefix when detail already has prefix", () => {
        const item = { name: "ALTER_AREA_REGION_MATCH", detail: "patch function ALTER_AREA_REGION_MATCH" };
        expect(getDetail(item, true, WEIDU_TP2_STANZAS.patch_functions)).toBe("patch function ALTER_AREA_REGION_MATCH");
    });

    it("does not add prefix when includeTypes is false", () => {
        const item = { name: "HANDLE_AUDIO" };
        expect(getDetail(item, false, WEIDU_TP2_STANZAS.action_functions)).toBe("HANDLE_AUDIO");
    });

    it("does not add prefix for non-callable stanzas", () => {
        const item = { name: "IF" };
        expect(getDetail(item, true, "keywords")).toBe("IF");
    });

    it("does not add prefix when stanzaName is undefined", () => {
        const item = { name: "HANDLE_AUDIO" };
        expect(getDetail(item, true)).toBe("HANDLE_AUDIO");
    });
});

describe("deprecation in hover output", () => {
    it("appends boolean deprecation notice to hover", () => {
        const data = {
            funcs: { type: 3, items: [{ name: "old_func", detail: "void old_func()", deprecated: true }] },
        };
        const result = generateHover(data, "lang");
        expect(result["old_func"]!.contents.value).toContain("**Deprecated**");
    });

    it("appends string deprecation notice to hover", () => {
        const data = {
            funcs: { type: 3, items: [{ name: "old_func", detail: "void old_func()", deprecated: "Use new_func instead" }] },
        };
        const result = generateHover(data, "lang");
        expect(result["old_func"]!.contents.value).toContain("**Deprecated:** Use new_func instead");
    });

    it("appends deprecation notice to completion documentation", () => {
        const data = {
            funcs: { type: 3, items: [{ name: "old_func", detail: "void old_func()", deprecated: true }] },
        };
        const result = generateCompletion(data, "lang");
        expect(result[0]!.documentation!.value).toContain("**Deprecated**");
    });

    it("does not add deprecation text when not deprecated", () => {
        const data = {
            funcs: { type: 3, items: [{ name: "func", detail: "void func()" }] },
        };
        const result = generateHover(data, "lang");
        expect(result["func"]!.contents.value).not.toContain("Deprecated");
    });
});

describe("generateCompletion (WeiDU)", () => {
    it("generates documentation for WeiDU items with args", () => {
        const data = {
            dimorphic_functions: {
                type: 3,
                items: [{
                    name: "SUBSTRING",
                    type: "dimorphic",
                    doc: "Returns a substring.",
                    args: [
                        { name: "start", type: "int", doc: "offset" },
                        { name: "text", type: "string", doc: "source" },
                    ],
                }],
            },
        };
        const result = generateCompletion(data, "weidu-tp2-tooltip");
        expect(result[0]!.documentation).toBeDefined();
        expect(result[0]!.documentation!.value).toContain("dimorphic function SUBSTRING");
        expect(result[0]!.documentation!.value).toContain("|**INT**|**vars**|||");
    });
});

describe("generateHover (WeiDU)", () => {
    it("generates hover with WeiDU tables", () => {
        const data = {
            dimorphic_functions: {
                type: 3,
                items: [{
                    name: "SUBSTRING",
                    type: "dimorphic",
                    doc: "Returns a substring.",
                    args: [
                        { name: "start", type: "int", doc: "offset" },
                    ],
                    rets: [
                        { name: "result", type: "string", doc: "the substring" },
                    ],
                }],
            },
        };
        const result = generateHover(data, "weidu-tp2-tooltip");
        expect(result["SUBSTRING"]).toBeDefined();
        const value = result["SUBSTRING"]!.contents.value;
        expect(value).toContain("dimorphic function SUBSTRING");
        expect(value).toContain("|**INT**|**vars**|||");
        expect(value).toContain("|**RET**|**vars**|||");
    });

    it("generates hover for items with only rets", () => {
        const data = {
            patch_functions: {
                type: 3,
                items: [{
                    name: "GET_AC",
                    rets: [{ name: "base_ac", type: "int", doc: "base AC" }],
                }],
            },
        };
        const result = generateHover(data, "weidu-tp2-tooltip");
        expect(result["GET_AC"]).toBeDefined();
        expect(result["GET_AC"]!.contents.value).toContain("|**RET**|**vars**|||");
    });
});

describe("generateSignatures (WeiDU)", () => {
    it("includes category prefix in WeiDU parameter docs", () => {
        const data = {
            dimorphic_functions: {
                type: 3,
                items: [{
                    name: "SUBSTRING",
                    type: "dimorphic",
                    doc: "Returns a substring.",
                    args: [
                        { name: "start", type: "int", doc: "offset" },
                        { name: "text", type: "string", doc: "source" },
                    ],
                }],
            },
        };
        const result = generateSignatures(data, "weidu-tp2-tooltip");
        expect(result["SUBSTRING"]).toBeDefined();
        expect(result["SUBSTRING"]!.label).toBe("SUBSTRING");
        // INT_VAR prefix for int arg
        expect(result["SUBSTRING"]!.parameters[0]!.documentation.value).toContain("INT_VAR int start");
        // STR_VAR prefix for string arg
        expect(result["SUBSTRING"]!.parameters[1]!.documentation.value).toContain("STR_VAR string text");
    });
});

describe("generateSignatures", () => {
    it("generates signature for items with args", () => {
        const data = {
            funcs: {
                type: 3,
                items: [{
                    name: "f",
                    type: "int",
                    doc: "A function.",
                    args: [{ name: "x", type: "int", doc: "the value" }],
                }],
            },
        };
        const result = generateSignatures(data, "lang");
        expect(result["f"]).toBeDefined();
        expect(result["f"]!.label).toBe("f(x)");
        expect(result["f"]!.parameters).toHaveLength(1);
        expect(result["f"]!.parameters[0]!.label).toBe("x");
        expect(result["f"]!.parameters[0]!.documentation.value).toContain("int x");
        expect(result["f"]!.documentation.value).toContain("A function.");
    });

    it("skips items without args", () => {
        const data = {
            kw: { type: 14, items: [{ name: "begin" }] },
        };
        const result = generateSignatures(data, "lang");
        expect(Object.keys(result)).toHaveLength(0);
    });

    it("emits signature object keys in sorted order", () => {
        const data = {
            zeta: {
                type: 3,
                items: [
                    { name: "zed", type: "int", args: [{ name: "x", type: "int" }] },
                    { name: "alpha", type: "int", args: [{ name: "x", type: "int" }] },
                ],
            },
            alpha: {
                type: 3,
                items: [
                    { name: "zulu", type: "int", args: [{ name: "x", type: "int" }] },
                    { name: "beta", type: "int", args: [{ name: "x", type: "int" }] },
                ],
            },
        };
        const result = generateSignatures(data, "lang");
        expect(Object.keys(result)).toEqual(["beta", "zulu", "alpha", "zed"]);
    });
});

describe("generateCompletion params field (WeiDU)", () => {
    it("includes params.intVar for WeiDU items with int args", () => {
        const data = {
            patch_functions: {
                type: 3,
                items: [{
                    name: "CLONE_EFFECT",
                    type: "patch",
                    args: [
                        { name: "opcode", type: "int", doc: "Effect opcode", default: "-1" },
                        { name: "match_resource", type: "string", doc: "Resource" },
                    ],
                }],
            },
        };
        const result = generateCompletion(data, "weidu-tp2-tooltip");
        const item = result[0]!;
        expect(item.params).toBeDefined();
        expect(item.params!.intVar).toHaveLength(1);
        expect(item.params!.intVar[0]).toMatchObject({ name: "opcode", type: "int", defaultValue: "-1", description: "Effect opcode" });
        expect(item.params!.strVar).toHaveLength(1);
        expect(item.params!.strVar[0]).toMatchObject({ name: "match_resource", type: "string", description: "Resource" });
    });

    it("includes params.ret for WeiDU items with rets", () => {
        const data = {
            patch_functions: {
                type: 3,
                items: [{
                    name: "GET_ITEM_AC",
                    type: "patch",
                    rets: [{ name: "base_ac", type: "int", doc: "base AC" }],
                }],
            },
        };
        const result = generateCompletion(data, "weidu-tp2-tooltip");
        const item = result[0]!;
        expect(item.params).toBeDefined();
        expect(item.params!.ret).toEqual(["base_ac"]);
        expect(item.params!.retArray).toEqual([]);
    });

    it("does not include params for non-WeiDU format items (no patch/action/dimorphic type)", () => {
        const data = {
            funcs: {
                type: 3,
                items: [{
                    name: "my_func",
                    type: "int",
                    args: [{ name: "x", type: "int", doc: "val" }],
                }],
            },
        };
        const result = generateCompletion(data, "fallout-ssl-tooltip");
        expect(result[0]!.params).toBeUndefined();
    });

    it("does not include params for items without args or rets", () => {
        const data = {
            patch_functions: {
                type: 3,
                items: [{ name: "SIMPLE_MACRO", type: "patch" }],
            },
        };
        const result = generateCompletion(data, "weidu-tp2-tooltip");
        expect(result[0]!.params).toBeUndefined();
    });

    it("marks required params correctly", () => {
        const data = {
            patch_functions: {
                type: 3,
                items: [{
                    name: "MY_FUNC",
                    type: "patch",
                    args: [
                        { name: "mandatory", type: "int", required: true },
                        { name: "optional", type: "int", default: "0" },
                    ],
                }],
            },
        };
        const result = generateCompletion(data, "weidu-tp2-tooltip");
        const params = result[0]!.params!;
        expect(params.intVar[0]).toMatchObject({ name: "mandatory", required: true });
        expect(params.intVar[1]).toMatchObject({ name: "optional", defaultValue: "0" });
        expect(params.intVar[1]!.required).toBeFalsy();
    });
});

// -- loadData validation error branches --

describe("loadData validation errors", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(TMP_BASE, ".loaddata-err-test-"));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true });
    });

    it("throws when stanza has no items array", () => {
        const yaml = `stanza1:\n  type: 3\n  items: "not-an-array"\n`;
        const f = path.join(tmpDir, "bad.yml");
        fs.writeFileSync(f, yaml, "utf8");
        expect(() => loadData([f])).toThrow("items");
    });

    it("throws when input is not an object", () => {
        // YAML top-level is a scalar, not an object
        const yaml = `"just a string"\n`;
        const f = path.join(tmpDir, "bad.yml");
        fs.writeFileSync(f, yaml, "utf8");
        expect(() => loadData([f])).toThrow();
    });
});

// -- generateHover: skip identical content branch --

describe("generateHover skip-identical branch", () => {
    it("skips duplicate hover entries with identical content across stanzas", () => {
        // Two stanzas with the same item name and same content -> keep one
        const data = {
            stanza1: { type: 3, items: [{ name: "foo", detail: "foo()" }] },
            stanza2: { type: 3, items: [{ name: "foo", detail: "foo()" }] },
        };
        const result = generateHover(data, "lang");
        expect(result["foo"]).toBeDefined();
        // Should contain only one copy, not two merged with separator
        expect(result["foo"]!.contents.value).not.toContain("---");
    });
});

// -- generateSignatures: getCategoryPrefix unknown type --

describe("generateSignatures getCategoryPrefix", () => {
    it("emits no prefix for unknown WeiDU type", () => {
        const data = {
            dimorphic_functions: {
                type: 3,
                items: [{
                    name: "MY_FUNC",
                    type: "dimorphic",
                    doc: "does things",
                    args: [{ name: "x", type: "unknowntype", doc: "x val" }],
                }],
            },
        };
        const result = generateSignatures(data, "weidu-tp2-tooltip");
        // No INT_VAR or STR_VAR prefix for unknown type
        expect(result["MY_FUNC"]!.parameters[0]!.documentation.value).toContain("unknowntype x");
        expect(result["MY_FUNC"]!.parameters[0]!.documentation.value).not.toContain("INT_VAR");
        expect(result["MY_FUNC"]!.parameters[0]!.documentation.value).not.toContain("STR_VAR");
    });
});

// -- sortDataItems: tiebreaker by detail --

describe("loadData sort tiebreaker", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(TMP_BASE, ".sort-tb-test-"));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true });
    });

    it("breaks ties by detail when names are equal", () => {
        // Two items with same name but different detail should be stable-sorted by detail
        const yaml = `stanza:\n  type: 3\n  items:\n    - name: foo\n      detail: "foo(b)"\n    - name: foo\n      detail: "foo(a)"\n`;
        const f = path.join(tmpDir, "a.yml");
        fs.writeFileSync(f, yaml, "utf8");
        const data = loadData([f]);
        const items = data["stanza"]!.items;
        // detail "foo(a)" < "foo(b)" so it should come first
        expect(items[0]!.detail).toBe("foo(a)");
        expect(items[1]!.detail).toBe("foo(b)");
    });
});
