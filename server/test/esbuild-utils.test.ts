/**
 * Unit tests for esbuild-utils.ts string-aware helpers and cleanupEsbuildOutput.
 * Covers: skipString, skipTemplateLiteral, skipBlockComment,
 * forEachCodeSegment, replaceOutsideStrings, cleanupEsbuildOutput.
 */

import { describe, expect, it } from "vitest";
import {
    skipString,
    skipTemplateLiteral,
    skipBlockComment,
    forEachCodeSegment,
    replaceOutsideStrings,
    cleanupEsbuildOutput,
} from "../../transpilers/common/esbuild-utils";

// -- skipString --

describe("skipString", () => {
    it("skips a double-quoted string", () => {
        const code = '"hello" + x';
        expect(skipString(code, 0)).toBe(7); // index after closing "
    });

    it("skips a single-quoted string", () => {
        const code = "'hello' + x";
        expect(skipString(code, 0)).toBe(7);
    });

    it("handles escaped quotes", () => {
        const code = '"he\\"llo" + x';
        expect(skipString(code, 0)).toBe(9);
    });

    it("handles escaped backslash before closing quote", () => {
        const code = '"hello\\\\" + x';
        // "hello\\" - backslash escapes backslash, then " closes
        expect(skipString(code, 0)).toBe(9);
    });

    it("handles unterminated string (returns end of code)", () => {
        const code = '"hello';
        expect(skipString(code, 0)).toBe(6);
    });

    it("skips string starting at non-zero offset", () => {
        const code = 'x + "world"';
        expect(skipString(code, 4)).toBe(11);
    });

    it("handles empty string", () => {
        const code = '""rest';
        expect(skipString(code, 0)).toBe(2);
    });
});

// -- skipTemplateLiteral --

describe("skipTemplateLiteral", () => {
    it("skips a simple template literal", () => {
        const code = "`hello` + x";
        expect(skipTemplateLiteral(code, 0)).toBe(7);
    });

    it("handles template with expression", () => {
        const code = "`hello ${name}` + x";
        expect(skipTemplateLiteral(code, 0)).toBe(15);
    });

    it("handles nested template literal in expression", () => {
        const code = "`outer ${`inner`}` + x";
        expect(skipTemplateLiteral(code, 0)).toBe(18);
    });

    it("handles string inside template expression", () => {
        const code = '`hello ${"world"}` + x';
        expect(skipTemplateLiteral(code, 0)).toBe(18);
    });

    it("handles nested braces in template expression", () => {
        const code = "`${fn({a: 1})}` + x";
        expect(skipTemplateLiteral(code, 0)).toBe(15);
    });

    it("handles escaped backtick", () => {
        const code = "`he\\`llo` + x";
        expect(skipTemplateLiteral(code, 0)).toBe(9);
    });

    it("handles unterminated template literal", () => {
        const code = "`hello";
        expect(skipTemplateLiteral(code, 0)).toBe(6);
    });

    it("handles empty template literal", () => {
        const code = "``rest";
        expect(skipTemplateLiteral(code, 0)).toBe(2);
    });

    it("handles multiple expressions", () => {
        const code = "`${a} and ${b}` + x";
        expect(skipTemplateLiteral(code, 0)).toBe(15);
    });

    it("handles deeply nested template with string containing backtick-like chars", () => {
        const code = "`${fn('arg')}` + x";
        expect(skipTemplateLiteral(code, 0)).toBe(14);
    });
});

// -- skipBlockComment --

describe("skipBlockComment", () => {
    it("skips a block comment", () => {
        const code = "/* comment */ + x";
        expect(skipBlockComment(code, 0)).toBe(13);
    });

    it("handles multi-line block comment", () => {
        const code = "/* line1\nline2 */ + x";
        expect(skipBlockComment(code, 0)).toBe(17);
    });

    it("handles unterminated block comment", () => {
        const code = "/* unterminated";
        expect(skipBlockComment(code, 0)).toBe(15);
    });

    it("handles block comment with asterisks inside", () => {
        // /*** star ***/ - first `*/` is at the `**` after "star ", index 12
        const code = "/*** star ***/ + x";
        expect(skipBlockComment(code, 0)).toBe(14);
    });

    it("skips block comment at non-zero offset", () => {
        const code = "x + /* comment */ y";
        expect(skipBlockComment(code, 4)).toBe(17);
    });
});

// -- forEachCodeSegment --

describe("forEachCodeSegment", () => {
    it("yields entire code when no strings or comments", () => {
        const segments: string[] = [];
        forEachCodeSegment("var x = 1;", (s) => segments.push(s));
        expect(segments).toEqual(["var x = 1;"]);
    });

    it("skips double-quoted strings", () => {
        const segments: string[] = [];
        forEachCodeSegment('var x = "foo" + y;', (s) => segments.push(s));
        expect(segments.join("")).not.toContain("foo");
        expect(segments.join("")).toContain("var x = ");
        expect(segments.join("")).toContain(" + y;");
    });

    it("skips single-quoted strings", () => {
        const segments: string[] = [];
        forEachCodeSegment("var x = 'foo' + y;", (s) => segments.push(s));
        expect(segments.join("")).not.toContain("foo");
    });

    it("skips template literals", () => {
        const segments: string[] = [];
        forEachCodeSegment("var x = `foo` + y;", (s) => segments.push(s));
        expect(segments.join("")).not.toContain("foo");
    });

    it("skips line comments", () => {
        const segments: string[] = [];
        forEachCodeSegment("var x = 1; // comment\nvar y = 2;", (s) => segments.push(s));
        const joined = segments.join("");
        expect(joined).not.toContain("comment");
        expect(joined).toContain("var x = 1; ");
        expect(joined).toContain("var y = 2;");
    });

    it("skips block comments", () => {
        const segments: string[] = [];
        forEachCodeSegment("var x = 1; /* comment */ var y = 2;", (s) => segments.push(s));
        const joined = segments.join("");
        expect(joined).not.toContain("comment");
        expect(joined).toContain("var x = 1; ");
        expect(joined).toContain(" var y = 2;");
    });

    it("skips multi-line block comments", () => {
        const segments: string[] = [];
        forEachCodeSegment("a /* multi\nline\ncomment */ b", (s) => segments.push(s));
        const joined = segments.join("");
        expect(joined).not.toContain("multi");
        expect(joined).not.toContain("line");
        expect(joined).toContain("a ");
        expect(joined).toContain(" b");
    });

    it("handles mixed strings and comments", () => {
        const segments: string[] = [];
        forEachCodeSegment('foo("bar") // baz\nqux', (s) => segments.push(s));
        const joined = segments.join("");
        expect(joined).toContain("foo(");
        expect(joined).toContain(")");
        expect(joined).not.toContain("bar");
        expect(joined).not.toContain("baz");
        expect(joined).toContain("qux");
    });

    it("handles empty input", () => {
        const segments: string[] = [];
        forEachCodeSegment("", (s) => segments.push(s));
        expect(segments).toEqual([]);
    });
});

// -- replaceOutsideStrings --

describe("replaceOutsideStrings", () => {
    it("replaces identifiers in plain code", () => {
        const result = replaceOutsideStrings("var foo = bar;", /\bbar\b/g, () => "baz");
        expect(result).toBe("var foo = baz;");
    });

    it("does not replace inside double-quoted strings", () => {
        const result = replaceOutsideStrings('var x = "bar" + bar;', /\bbar\b/g, () => "baz");
        expect(result).toBe('var x = "bar" + baz;');
    });

    it("does not replace inside single-quoted strings", () => {
        const result = replaceOutsideStrings("var x = 'bar' + bar;", /\bbar\b/g, () => "baz");
        expect(result).toBe("var x = 'bar' + baz;");
    });

    it("does not replace inside template literals", () => {
        const result = replaceOutsideStrings("var x = `bar` + bar;", /\bbar\b/g, () => "baz");
        expect(result).toBe("var x = `bar` + baz;");
    });

    it("does not replace inside line comments", () => {
        const result = replaceOutsideStrings("bar; // bar\nbar;", /\bbar\b/g, () => "baz");
        expect(result).toBe("baz; // bar\nbaz;");
    });

    it("does not replace inside block comments", () => {
        const result = replaceOutsideStrings("bar; /* bar */ bar;", /\bbar\b/g, () => "baz");
        expect(result).toBe("baz; /* bar */ baz;");
    });

    it("does not replace inside multi-line block comments", () => {
        const result = replaceOutsideStrings("bar;\n/* bar\nbar */\nbar;", /\bbar\b/g, () => "baz");
        expect(result).toBe("baz;\n/* bar\nbar */\nbaz;");
    });

    it("handles strings with escaped quotes", () => {
        const result = replaceOutsideStrings('var x = "ba\\"r" + bar;', /\bbar\b/g, () => "baz");
        expect(result).toBe('var x = "ba\\"r" + baz;');
    });

    it("handles multiple replacements", () => {
        const result = replaceOutsideStrings("foo + foo + foo", /\bfoo\b/g, () => "bar");
        expect(result).toBe("bar + bar + bar");
    });

    it("handles empty input", () => {
        const result = replaceOutsideStrings("", /\bfoo\b/g, () => "bar");
        expect(result).toBe("");
    });

    it("preserves template expressions while skipping template text", () => {
        // The identifier inside ${} is part of the template literal and should be preserved as-is
        const result = replaceOutsideStrings("bar + `text ${bar}` + bar", /\bbar\b/g, () => "baz");
        expect(result).toBe("baz + `text ${bar}` + baz");
    });
});

// -- cleanupEsbuildOutput --

describe("cleanupEsbuildOutput", () => {
    const MARKER = "/* __CODE_START__ */";

    it("strips everything before the marker", () => {
        const code = `var __defProp = {};\n${MARKER}\nvar x = 1;`;
        const result = cleanupEsbuildOutput(code, MARKER);
        expect(result).toBe("var x = 1;");
    });

    it("returns code as-is when no marker found", () => {
        const code = "var x = 1;";
        const result = cleanupEsbuildOutput(code, MARKER);
        expect(result).toBe("var x = 1;");
    });

    it("removes import declarations", () => {
        const code = `${MARKER}\nimport { foo } from "bar";\nvar x = foo;`;
        const result = cleanupEsbuildOutput(code, MARKER);
        expect(result).not.toContain("import");
        expect(result).toContain("var x = foo;");
    });

    it("renames import aliases back to originals", () => {
        const code = `${MARKER}\nimport { original as alias } from "mod";\nvar x = alias;`;
        const result = cleanupEsbuildOutput(code, MARKER);
        expect(result).toContain("var x = original;");
        expect(result).not.toContain("alias");
    });

    it("does not rename aliases inside strings", () => {
        const code = `${MARKER}\nimport { original as alias } from "mod";\nvar x = alias + "alias";`;
        const result = cleanupEsbuildOutput(code, MARKER);
        expect(result).toContain('var x = original + "alias";');
    });

    it("handles esbuild collision pattern (alias2 -> alias22)", () => {
        // When esbuild imports `See as See2`, and the code already uses `See22`
        // (the original `See2` renamed by esbuild to avoid collision), the cleanup
        // should detect the collision: rename See22 -> See2, drop the See2 -> See alias.
        // See22 is the code's original identifier that got an extra digit appended.
        const code = `${MARKER}\nimport { See as See2 } from "mod";\nvar a = See2;\nvar b = See22;`;
        const result = cleanupEsbuildOutput(code, MARKER);
        // See2 (the import alias) stays as See2 because the collision was detected
        expect(result).toContain("var a = See2;");
        // See22 (the collision-renamed original) gets restored to See2
        expect(result).toContain("var b = See2;");
    });

    it("restores esbuild-renamed constants using originalConstants", () => {
        const constants = new Map([["DIK_F4", "62"]]);
        const code = `${MARKER}\nvar DIK_F42 = 62;\nvar x = DIK_F42;`;
        const result = cleanupEsbuildOutput(code, MARKER, constants);
        expect(result).toContain("var DIK_F4 = 62;");
        expect(result).toContain("var x = DIK_F4;");
    });

    it("does not restore constant when value does not match", () => {
        const constants = new Map([["DIK_F4", "62"]]);
        const code = `${MARKER}\nvar DIK_F42 = 99;\nvar x = DIK_F42;`;
        const result = cleanupEsbuildOutput(code, MARKER, constants);
        expect(result).toContain("var DIK_F42 = 99;");
    });

    it("handles multiple import aliases", () => {
        const code = `${MARKER}\nimport { foo as foo2, bar as bar2 } from "mod";\nvar x = foo2 + bar2;`;
        const result = cleanupEsbuildOutput(code, MARKER);
        expect(result).toContain("var x = foo + bar;");
    });

    it("does not rename inside block comments", () => {
        const code = `${MARKER}\nimport { original as alias } from "mod";\nalias; /* alias */`;
        const result = cleanupEsbuildOutput(code, MARKER);
        expect(result).toContain("original; /* alias */");
    });
});
