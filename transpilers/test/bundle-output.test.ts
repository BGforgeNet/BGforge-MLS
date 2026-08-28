/**
 * The string-manipulation seams of the bundler pipeline
 * (transpilers/common/bundle-output.ts): the marker-stripping/alias-fixup
 * cleanup pass and its string/comment-aware scanning helpers.
 *
 * These run entirely on plain strings - the bundler is never invoked - so they
 * are unit-tested directly rather than through a real bundling run (which is
 * covered by api.test.ts/bundle.test.ts).
 */
import { describe, expect, it } from "vitest";
import {
    cleanupBundleOutput,
    forEachCodeSegment,
    replaceOutsideStrings,
    skipBlockComment,
    skipString,
    skipTemplateLiteral,
} from "../common/bundle-output";

describe("cleanupBundleOutput", () => {
    const MARKER = "/* __MARK__ */";

    it("strips everything before the marker", () => {
        const code = `var __defProp = 1;\n${MARKER}\nconst x = 1;\n`;
        expect(cleanupBundleOutput(code, MARKER)).toBe("const x = 1;\n");
    });

    it("returns the code unchanged when the marker is absent", () => {
        const code = "const x = 1;\n";
        expect(cleanupBundleOutput(code, MARKER)).toBe(code);
    });

    it("removes import declarations and renames aliased identifiers back to the original", () => {
        const code = `${MARKER}\nimport { See as See2 } from "folib";\nif (See2(Player1)) {\n  Attack(Player1);\n}\n`;
        const cleaned = cleanupBundleOutput(code, MARKER);
        expect(cleaned).not.toContain("import");
        expect(cleaned).toContain("if (See(Player1))");
    });

    it("handles multiple import aliases", () => {
        const code = `${MARKER}\nimport { foo as foo2, bar as bar2 } from "mod";\nvar x = foo2 + bar2;`;
        expect(cleanupBundleOutput(code, MARKER)).toContain("var x = foo + bar;");
    });

    it("does not rename an alias-like identifier inside a string literal", () => {
        const code = `${MARKER}\nimport { See as See2 } from "folib";\nconst label = "See2 in text";\nSee2(Player1);\n`;
        const cleaned = cleanupBundleOutput(code, MARKER);
        expect(cleaned).toContain('const label = "See2 in text";');
        expect(cleaned).toContain("See(Player1);");
    });

    it("does not rename inside block comments", () => {
        const code = `${MARKER}\nimport { original as alias } from "mod";\nalias; /* alias */`;
        expect(cleanupBundleOutput(code, MARKER)).toContain("original; /* alias */");
    });

    it("handles the collision pattern (alias2 -> alias22)", () => {
        // When the bundler imports `See as See2`, and the code already uses `See22`
        // (the original `See2`, renamed to avoid the collision), the cleanup
        // should detect the collision: rename See22 -> See2, drop the See2 -> See alias.
        // See22 is the code's original identifier that got an extra digit appended.
        const code = `${MARKER}\nimport { See as See2 } from "mod";\nvar a = See2;\nvar b = See22;`;
        const cleaned = cleanupBundleOutput(code, MARKER);
        // See2 (the import alias) stays as See2 because the collision was detected
        expect(cleaned).toContain("var a = See2;");
        // See22 (the collision-renamed original) gets restored to See2
        expect(cleaned).toContain("var b = See2;");
    });

    // The cleanup drops lines - the bundler's prelude ahead of the marker, and every import declaration -
    // so a position in its output names a different line than the same code had on the way in. Reporting
    // which input line each surviving line came from is what lets an error found later be traced back.
    describe("line survival", () => {
        it("reports the input line each surviving line came from", () => {
            const code = `var __defProp = 1;\n${MARKER}\nconst x = 1;\nconst y = 2;\n`;
            const survivors: number[] = [];
            cleanupBundleOutput(code, MARKER, survivors);
            // Input lines 0 and 1 are the prelude and the marker; the two survivors are lines 2 and 3.
            expect(survivors).toEqual([2, 3]);
        });

        it("accounts for a removed import declaration between surviving lines", () => {
            const code = `${MARKER}\nconst a = 1;\nimport { See } from "folib";\nconst b = 2;\n`;
            const survivors: number[] = [];
            cleanupBundleOutput(code, MARKER, survivors);
            expect(survivors).toEqual([1, 3]);
        });

        it("accounts for an import declaration spanning several lines", () => {
            const code = `${MARKER}\nimport {\n  See,\n  Attack\n} from "folib";\nconst b = 2;\n`;
            const survivors: number[] = [];
            cleanupBundleOutput(code, MARKER, survivors);
            expect(survivors).toEqual([5]);
        });

        it("maps every line to itself when there is nothing to strip", () => {
            const code = "const x = 1;\nconst y = 2;\n";
            const survivors: number[] = [];
            cleanupBundleOutput(code, MARKER, survivors);
            expect(survivors).toEqual([0, 1]);
        });
    });
});

describe("skipString", () => {
    it("skips a double-quoted string", () => {
        const code = '"hello" + x';
        expect(skipString(code, 0)).toBe(7); // index after closing "
    });

    it("skips a single-quoted string", () => {
        const code = "'hello' + x";
        expect(skipString(code, 0)).toBe(7);
    });

    it("returns the index past the closing quote, honoring backslash escapes", () => {
        const code = `"a\\"b" rest`;
        expect(skipString(code, 0)).toBe(code.indexOf(" rest"));
    });

    it("handles an escaped backslash before the closing quote", () => {
        const code = '"hello\\\\" + x';
        // "hello\\" - backslash escapes backslash, then " closes
        expect(skipString(code, 0)).toBe(9);
    });

    it("handles an unterminated string (returns end of code)", () => {
        const code = '"hello';
        expect(skipString(code, 0)).toBe(6);
    });

    it("skips a string starting at a non-zero offset", () => {
        const code = 'x + "world"';
        expect(skipString(code, 4)).toBe(11);
    });

    it("handles an empty string", () => {
        const code = '""rest';
        expect(skipString(code, 0)).toBe(2);
    });
});

describe("skipTemplateLiteral", () => {
    it("skips a simple template literal", () => {
        const code = "`hello` + x";
        expect(skipTemplateLiteral(code, 0)).toBe(7);
    });

    it("handles a template with an expression", () => {
        const code = "`hello ${name}` + x";
        expect(skipTemplateLiteral(code, 0)).toBe(15);
    });

    it("handles a nested template literal in an expression", () => {
        const code = "`outer ${`inner`}` + x";
        expect(skipTemplateLiteral(code, 0)).toBe(18);
    });

    it("skips over a template expression that itself contains a nested string", () => {
        const code = '`a${"}"}b` rest';
        expect(skipTemplateLiteral(code, 0)).toBe(code.indexOf(" rest"));
    });

    it("handles nested braces in a template expression", () => {
        const code = "`${fn({a: 1})}` + x";
        expect(skipTemplateLiteral(code, 0)).toBe(15);
    });

    it("handles an escaped backtick", () => {
        const code = "`he\\`llo` + x";
        expect(skipTemplateLiteral(code, 0)).toBe(9);
    });

    it("handles an unterminated template literal", () => {
        const code = "`hello";
        expect(skipTemplateLiteral(code, 0)).toBe(6);
    });

    it("handles an empty template literal", () => {
        const code = "``rest";
        expect(skipTemplateLiteral(code, 0)).toBe(2);
    });

    it("handles multiple expressions", () => {
        const code = "`${a} and ${b}` + x";
        expect(skipTemplateLiteral(code, 0)).toBe(15);
    });

    it("handles a nested single-quoted string in an expression", () => {
        const code = "`${fn('arg')}` + x";
        expect(skipTemplateLiteral(code, 0)).toBe(14);
    });
});

describe("skipBlockComment", () => {
    it("returns the index past the closing */", () => {
        const code = "/* comment */ rest";
        expect(skipBlockComment(code, 0)).toBe(code.indexOf(" rest"));
    });

    it("handles a multi-line block comment", () => {
        const code = "/* line1\nline2 */ + x";
        expect(skipBlockComment(code, 0)).toBe(17);
    });

    it("returns the code length when the block comment is unterminated", () => {
        const code = "/* never closed";
        expect(skipBlockComment(code, 0)).toBe(code.length);
    });

    it("handles a block comment with asterisks inside", () => {
        // /*** star ***/ - first `*/` is at the `**` after "star ", index 12
        const code = "/*** star ***/ + x";
        expect(skipBlockComment(code, 0)).toBe(14);
    });

    it("skips a block comment at a non-zero offset", () => {
        const code = "x + /* comment */ y";
        expect(skipBlockComment(code, 4)).toBe(17);
    });
});

describe("forEachCodeSegment", () => {
    it("yields the entire code when there are no strings or comments", () => {
        const segments: string[] = [];
        forEachCodeSegment("var x = 1;", (s) => segments.push(s));
        expect(segments).toEqual(["var x = 1;"]);
    });

    it("skips single/double/template string contents and line/block comments", () => {
        const code = "let a = \"skip1\"; // skip2\nlet b = 'skip3'; /* skip4 */ let c = `skip5`; let real = 1;";
        const segments: string[] = [];
        forEachCodeSegment(code, (s) => segments.push(s));
        const joined = segments.join("");
        expect(joined).not.toMatch(/skip[12345]/);
        expect(joined).toContain("real = 1;");
    });

    it("skips multi-line block comments", () => {
        const segments: string[] = [];
        forEachCodeSegment("a /* multi\nline\ncomment */ b", (s) => segments.push(s));
        const joined = segments.join("");
        expect(joined).not.toContain("multi");
        expect(joined).toContain("a ");
        expect(joined).toContain(" b");
    });

    it("handles empty input", () => {
        const segments: string[] = [];
        forEachCodeSegment("", (s) => segments.push(s));
        expect(segments).toEqual([]);
    });
});

describe("replaceOutsideStrings", () => {
    it("replaces matches only outside string/template/comment spans", () => {
        const code = 'foo("foo"); // foo\nconst t = `foo`;\nfoo();';
        const result = replaceOutsideStrings(code, /\bfoo\b/g, () => "bar");
        expect(result).toBe('bar("foo"); // foo\nconst t = `foo`;\nbar();');
    });

    it("does not replace inside multi-line block comments", () => {
        const result = replaceOutsideStrings("bar;\n/* bar\nbar */\nbar;", /\bbar\b/g, () => "baz");
        expect(result).toBe("baz;\n/* bar\nbar */\nbaz;");
    });

    it("handles strings with escaped quotes", () => {
        const result = replaceOutsideStrings('var x = "ba\\"r" + bar;', /\bbar\b/g, () => "baz");
        expect(result).toBe('var x = "ba\\"r" + baz;');
    });

    it("preserves template expressions while skipping template text", () => {
        // The identifier inside ${} is part of the template literal and is preserved as-is
        const result = replaceOutsideStrings("bar + `text ${bar}` + bar", /\bbar\b/g, () => "baz");
        expect(result).toBe("baz + `text ${bar}` + baz");
    });

    it("handles empty input", () => {
        const result = replaceOutsideStrings("", /\bfoo\b/g, () => "bar");
        expect(result).toBe("");
    });
});
