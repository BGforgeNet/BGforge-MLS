/**
 * Tests for shared YAML/text helpers: cmpStr, litscal, findFiles, makeBlockScalar.
 */

import fs from "node:fs";
import path from "node:path";
import { Document, isScalar, Scalar } from "yaml";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    cmpStr,
    findFiles,
    litscal,
    makeBlockScalar,
    parseYamlDocStrict,
    YAML_DUMP_OPTIONS,
} from "../src/yaml-helpers.ts";

const TMP_BASE = "tmp";
beforeAll(() => fs.mkdirSync(TMP_BASE, { recursive: true }));

describe("cmpStr", () => {
    it("returns negative for a < b", () => {
        expect(cmpStr("abc", "abd")).toBeLessThan(0);
    });

    it("returns positive for a > b", () => {
        expect(cmpStr("abd", "abc")).toBeGreaterThan(0);
    });

    it("returns zero for equal strings", () => {
        expect(cmpStr("abc", "abc")).toBe(0);
    });

    it("sorts underscore after uppercase Z (byte order)", () => {
        expect(cmpStr("_", "Z")).toBeGreaterThan(0);
    });
});

describe("litscal", () => {
    it("dedents text with common indentation", () => {
        const input = "  line1\n  line2\n  line3";
        expect(litscal(input)).toBe("line1\nline2\nline3");
    });

    it("preserves relative indentation", () => {
        const input = "  line1\n    line2\n  line3";
        expect(litscal(input)).toBe("line1\n  line2\nline3");
    });

    it("handles text without common indentation", () => {
        const input = "line1\nline2";
        expect(litscal(input)).toBe("line1\nline2");
    });

    it("handles empty lines in indentation calculation", () => {
        const input = "  line1\n\n  line2";
        expect(litscal(input)).toBe("line1\n\nline2");
    });
});

describe("findFiles", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(TMP_BASE, ".utils-test-"));
        fs.mkdirSync(path.join(tmpDir, "sub"), { recursive: true });
        fs.mkdirSync(path.join(tmpDir, "skip"), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, "a.yml"), "", "utf8");
        fs.writeFileSync(path.join(tmpDir, "sub", "b.yml"), "", "utf8");
        fs.writeFileSync(path.join(tmpDir, "skip", "c.yml"), "", "utf8");
        fs.writeFileSync(path.join(tmpDir, "d.txt"), "", "utf8");
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true });
    });

    it("finds files by extension", () => {
        const result = findFiles(tmpDir, "yml");
        expect(result).toHaveLength(3);
    });

    it("skips specified directories", () => {
        const result = findFiles(tmpDir, "yml", ["skip"]);
        expect(result).toHaveLength(2);
    });

    it("skips specified files", () => {
        const result = findFiles(tmpDir, "yml", [], ["b.yml"]);
        expect(result).toHaveLength(2);
    });

    it("returns results in sorted order", () => {
        // Directory traversal is alphabetical: a.yml, then skip/c.yml, then sub/b.yml
        const result = findFiles(tmpDir, "yml");
        const basenames = result.map((f) => path.basename(f));
        expect(basenames).toEqual(["a.yml", "c.yml", "b.yml"]);
    });
});

describe("makeBlockScalar", () => {
    it("creates a block literal scalar node", () => {
        const doc = new Document();
        const node = makeBlockScalar(doc, "hello\nworld");
        expect(isScalar(node)).toBe(true);
        expect(node.type).toBe(Scalar.BLOCK_LITERAL);
        expect(node.value).toBe("hello\nworld");
    });
});

describe("YAML_DUMP_OPTIONS", () => {
    it("has expected configuration values", () => {
        expect(YAML_DUMP_OPTIONS.lineWidth).toBe(4096);
        expect(YAML_DUMP_OPTIONS.indent).toBe(2);
        expect(YAML_DUMP_OPTIONS.indentSeq).toBe(true);
    });
});

describe("parseYamlDocStrict", () => {
    it("throws on duplicate map keys", () => {
        expect(() => parseYamlDocStrict("a: 1\na: 2\n")).toThrow(/unique/i);
    });

    it("returns a Document on valid input", () => {
        const doc = parseYamlDocStrict("a: 1\nb: 2\n");
        expect(doc.toJS()).toEqual({ a: 1, b: 2 });
    });

    it("forwards parse options", () => {
        const doc = parseYamlDocStrict("a: 1\n", { keepSourceTokens: true });
        expect(doc.toJS()).toEqual({ a: 1 });
    });

    it("throws on other parse errors", () => {
        expect(() => parseYamlDocStrict("a: [unclosed\n")).toThrow();
    });
});
