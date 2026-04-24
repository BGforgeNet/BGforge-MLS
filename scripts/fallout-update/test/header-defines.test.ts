/**
 * Tests for header-defines module: parsing .h files for defines,
 * file discovery, and define collection.
 * Shared cmpStr and findFiles tests are in utils/test/yaml-helpers.test.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { collectDefines, definesFromFile, findFile } from "../src/fallout/header-defines.ts";

const TMP_BASE = "tmp";
beforeAll(() => fs.mkdirSync(TMP_BASE, { recursive: true }));

describe("definesFromFile", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(TMP_BASE, ".fallout-test-"));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true });
    });

    it("extracts numeric constants", () => {
        const filePath = path.join(tmpDir, "test.h");
        fs.writeFileSync(filePath, "#define some_const (42)\n", "utf8");
        const defines = definesFromFile(filePath);
        expect(defines.get("some_const")).toBe("constant");
    });

    it("skips properly named constants (UPPER_CASE)", () => {
        const filePath = path.join(tmpDir, "test.h");
        fs.writeFileSync(filePath, "#define MY_CONSTANT (42)\n", "utf8");
        const defines = definesFromFile(filePath);
        expect(defines.has("MY_CONSTANT")).toBe(false);
    });

    it("extracts variables (GVAR/MVAR/LVAR)", () => {
        const filePath = path.join(tmpDir, "test.h");
        fs.writeFileSync(filePath, "#define GVAR_MY_VAR (10)\n#define MVAR_SOMETHING (5)\n", "utf8");
        const defines = definesFromFile(filePath);
        expect(defines.get("GVAR_MY_VAR")).toBe("variable");
        expect(defines.get("MVAR_SOMETHING")).toBe("variable");
    });

    it("extracts procedures", () => {
        const filePath = path.join(tmpDir, "test.h");
        fs.writeFileSync(filePath, "procedure my_proc begin\n", "utf8");
        const defines = definesFromFile(filePath);
        expect(defines.get("my_proc")).toBe("procedure");
    });

    it("does not match procedures with args (original regex limitation)", () => {
        // The procedure regex from the Python script only matches argless procedures.
        // Procedures with args in parens are not matched. This preserves the original behavior.
        const filePath = path.join(tmpDir, "test.h");
        fs.writeFileSync(filePath, "procedure my_proc(variable arg1, variable arg2) begin\n", "utf8");
        const defines = definesFromFile(filePath);
        expect(defines.has("my_proc")).toBe(false);
    });

    it("extracts defines with arguments", () => {
        const filePath = path.join(tmpDir, "test.h");
        fs.writeFileSync(filePath, "#define my_macro(x, y) something\n", "utf8");
        const defines = definesFromFile(filePath);
        expect(defines.get("my_macro")).toBe("define_with_vars");
    });

    it("extracts aliases", () => {
        const filePath = path.join(tmpDir, "test.h");
        fs.writeFileSync(filePath, "#define float_color_normal FLOAT_MSG_YELLOW\n", "utf8");
        const defines = definesFromFile(filePath);
        expect(defines.get("float_color_normal")).toBe("alias");
    });

    it("skips properly named aliases (UPPER_CASE)", () => {
        const filePath = path.join(tmpDir, "test.h");
        fs.writeFileSync(filePath, "#define FLOAT_COLOR OTHER_THING\n", "utf8");
        const defines = definesFromFile(filePath);
        expect(defines.has("FLOAT_COLOR")).toBe(false);
    });

    it("prioritizes variable over constant for GVAR/MVAR/LVAR", () => {
        const filePath = path.join(tmpDir, "test.h");
        fs.writeFileSync(filePath, "#define GVAR_QUEST_STATUS (1)\n", "utf8");
        const defines = definesFromFile(filePath);
        // GVAR_ matches variable regex first, even though the name also matches constant regex
        expect(defines.get("GVAR_QUEST_STATUS")).toBe("variable");
    });

    it("handles mixed content in a single file", () => {
        const filePath = path.join(tmpDir, "test.h");
        const content = [
            "#define some_const (42)",
            "#define GVAR_MY_VAR (10)",
            "procedure do_stuff begin",
            "#define my_macro(x) something",
            "#define alias_name OTHER",
            "// comment line",
            "",
        ].join("\n");
        fs.writeFileSync(filePath, content, "utf8");
        const defines = definesFromFile(filePath);
        expect(defines.get("some_const")).toBe("constant");
        expect(defines.get("GVAR_MY_VAR")).toBe("variable");
        expect(defines.get("do_stuff")).toBe("procedure");
        expect(defines.get("my_macro")).toBe("define_with_vars");
        expect(defines.get("alias_name")).toBe("alias");
    });
});

describe("findFile", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(TMP_BASE, ".fallout-test-"));
        fs.mkdirSync(path.join(tmpDir, "sub"), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, "sub", "target.yml"), "data", "utf8");
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true });
    });

    it("finds a file recursively", () => {
        const result = findFile(tmpDir, "target.yml");
        expect(result).toBeDefined();
        expect(path.basename(result!)).toBe("target.yml");
    });

    it("returns undefined when file not found", () => {
        const result = findFile(tmpDir, "nonexistent.yml");
        expect(result).toBeUndefined();
    });
});

describe("collectDefines", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(TMP_BASE, ".fallout-test-"));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true });
    });

    it("merges defines from multiple files (last-writer-wins)", () => {
        fs.writeFileSync(path.join(tmpDir, "a.h"), "#define some_const (1)\n", "utf8");
        // Same name in second file overwrites: define_with_vars from alias
        fs.writeFileSync(path.join(tmpDir, "b.h"), "#define some_const OTHER\n", "utf8");
        const defines = collectDefines(tmpDir);
        // b.h processed after a.h alphabetically, so alias wins
        expect(defines.get("some_const")).toBe("alias");
    });

    it("returns entries sorted alphabetically", () => {
        fs.writeFileSync(path.join(tmpDir, "test.h"), "#define zebra_const (1)\n#define alpha_const (2)\n", "utf8");
        const defines = collectDefines(tmpDir);
        const keys = [...defines.keys()];
        expect(keys).toEqual(["alpha_const", "zebra_const"]);
    });
});
