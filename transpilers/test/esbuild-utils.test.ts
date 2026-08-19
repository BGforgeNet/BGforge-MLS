/**
 * Pure string-manipulation seams of the shared esbuild bundler
 * (transpilers/common/esbuild-utils.ts): the marker-stripping/alias-fixup
 * cleanup pass and its string/comment-aware scanning helpers.
 *
 * These run entirely on plain strings - no esbuild-wasm invocation - so they
 * are unit-tested directly rather than through a real bundling run (which is
 * covered by api.test.ts/bundle.test.ts).
 */
import { describe, expect, it } from "vitest";
import {
    cleanupEsbuildOutput,
    forEachCodeSegment,
    replaceOutsideStrings,
    skipBlockComment,
    skipString,
    skipTemplateLiteral,
} from "../common/esbuild-utils";

describe("cleanupEsbuildOutput", () => {
    const MARKER = "/* __MARK__ */";

    it("strips everything before the marker", () => {
        const code = `var __defProp = 1;\n${MARKER}\nconst x = 1;\n`;
        expect(cleanupEsbuildOutput(code, MARKER)).toBe("const x = 1;\n");
    });

    it("returns the code unchanged when the marker is absent", () => {
        const code = "const x = 1;\n";
        expect(cleanupEsbuildOutput(code, MARKER)).toBe(code);
    });

    it("removes import declarations and renames aliased identifiers back to the original", () => {
        const code = `${MARKER}\nimport { See as See2 } from "folib";\nif (See2(Player1)) {\n  Attack(Player1);\n}\n`;
        const cleaned = cleanupEsbuildOutput(code, MARKER);
        expect(cleaned).not.toContain("import");
        expect(cleaned).toContain("if (See(Player1))");
    });

    it("does not rename an alias-like identifier inside a string literal", () => {
        const code = `${MARKER}\nimport { See as See2 } from "folib";\nconst label = "See2 in text";\nSee2(Player1);\n`;
        const cleaned = cleanupEsbuildOutput(code, MARKER);
        expect(cleaned).toContain('const label = "See2 in text";');
        expect(cleaned).toContain("See(Player1);");
    });

    // The cleanup drops lines - the bundler's prelude ahead of the marker, and every import declaration -
    // so a position in its output names a different line than the same code had on the way in. Reporting
    // which input line each surviving line came from is what lets an error found later be traced back.
    describe("line survival", () => {
        it("reports the input line each surviving line came from", () => {
            const code = `var __defProp = 1;\n${MARKER}\nconst x = 1;\nconst y = 2;\n`;
            const survivors: number[] = [];
            cleanupEsbuildOutput(code, MARKER, survivors);
            // Input lines 0 and 1 are the prelude and the marker; the two survivors are lines 2 and 3.
            expect(survivors).toEqual([2, 3]);
        });

        it("accounts for a removed import declaration between surviving lines", () => {
            const code = `${MARKER}\nconst a = 1;\nimport { See } from "folib";\nconst b = 2;\n`;
            const survivors: number[] = [];
            cleanupEsbuildOutput(code, MARKER, survivors);
            expect(survivors).toEqual([1, 3]);
        });

        it("accounts for an import declaration spanning several lines", () => {
            const code = `${MARKER}\nimport {\n  See,\n  Attack\n} from "folib";\nconst b = 2;\n`;
            const survivors: number[] = [];
            cleanupEsbuildOutput(code, MARKER, survivors);
            expect(survivors).toEqual([5]);
        });

        it("maps every line to itself when there is nothing to strip", () => {
            const code = "const x = 1;\nconst y = 2;\n";
            const survivors: number[] = [];
            cleanupEsbuildOutput(code, MARKER, survivors);
            expect(survivors).toEqual([0, 1]);
        });
    });
});

describe("forEachCodeSegment", () => {
    it("skips single/double/template string contents and line/block comments", () => {
        const code = "let a = \"skip1\"; // skip2\nlet b = 'skip3'; /* skip4 */ let c = `skip5`; let real = 1;";
        const segments: string[] = [];
        forEachCodeSegment(code, (s) => segments.push(s));
        const joined = segments.join("");
        expect(joined).not.toMatch(/skip[12345]/);
        expect(joined).toContain("real = 1;");
    });
});

describe("replaceOutsideStrings", () => {
    it("replaces matches only outside string/template/comment spans", () => {
        const code = 'foo("foo"); // foo\nconst t = `foo`;\nfoo();';
        const result = replaceOutsideStrings(code, /\bfoo\b/g, () => "bar");
        expect(result).toBe('bar("foo"); // foo\nconst t = `foo`;\nbar();');
    });
});

describe("skipString", () => {
    it("returns the index past the closing quote, honoring backslash escapes", () => {
        const code = `"a\\"b" rest`;
        expect(skipString(code, 0)).toBe(code.indexOf(" rest"));
    });
});

describe("skipTemplateLiteral", () => {
    it("skips over a template expression that itself contains a nested string", () => {
        const code = '`a${"}"}b` rest';
        expect(skipTemplateLiteral(code, 0)).toBe(code.indexOf(" rest"));
    });
});

describe("skipBlockComment", () => {
    it("returns the index past the closing */", () => {
        const code = "/* comment */ rest";
        expect(skipBlockComment(code, 0)).toBe(code.indexOf(" rest"));
    });

    it("returns the code length when the block comment is unterminated", () => {
        const code = "/* never closed";
        expect(skipBlockComment(code, 0)).toBe(code.length);
    });
});
