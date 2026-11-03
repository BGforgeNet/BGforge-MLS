import { describe, expect, test } from "vitest";
import { cpuTimeMs } from "@bgforge/shared/cpu-time";
import { extractTraTag, hasImports, makeGeneratedHeader, stripQuotes } from "../common/transpiler-utils";

describe("stripQuotes", () => {
    test("folds double, single, and backtick quoting to the same bare content", () => {
        expect(stripQuotes('"hello"')).toBe("hello");
        expect(stripQuotes("'hello'")).toBe("hello");
        expect(stripQuotes("`hello`")).toBe("hello");
        expect(stripQuotes("hello")).toBe("hello");
    });
});

describe("hasImports", () => {
    test("detects a leading import statement", () => {
        expect(hasImports('import { X } from "y";\nconst z = 1;')).toBe(true);
    });

    test("detects a re-export-all statement", () => {
        expect(hasImports('export * from "y";\n')).toBe(true);
    });

    test("returns false for source with no import/re-export statements", () => {
        expect(hasImports("const z = 1;\nfunction f() {}\n")).toBe(false);
    });

    test("detects an import after blank lines or indentation, on any line", () => {
        expect(hasImports('\n\n  \t import X from "y";')).toBe(true);
        expect(hasImports('const a = 1;\n\n\n   import X from "y";\n')).toBe(true);
        expect(hasImports('const a = 1;\r\nimport X from "y";\r\n')).toBe(true);
        expect(hasImports("export   *   from 'y'")).toBe(true);
    });

    test("scans a long run of line and paragraph separators in linear time", () => {
        // Under `m` both separators end a line, so the leading-blank class must stop at them as it does at \n.
        for (const separator of [String.fromCodePoint(0x2028), String.fromCodePoint(0x2029)]) {
            const text = separator.repeat(100_000) + "const z = 1;";
            let found: boolean | undefined;
            const elapsed = cpuTimeMs(() => {
                found = hasImports(text);
            });
            expect(found).toBe(false);
            expect(elapsed).toBeLessThan(500);
        }
    });

    test("needs the keyword to open its line and be followed by a blank", () => {
        expect(hasImports('const a = 1; import X from "y";')).toBe(false);
        expect(hasImports('import("y")')).toBe(false);
        expect(hasImports("important();")).toBe(false);
        expect(hasImports("export const a = 1;")).toBe(false);
        expect(hasImports("export * as ns from 'y'")).toBe(false);
        expect(hasImports("")).toBe(false);
    });

    test("scans a long run of blank lines in linear time", () => {
        const text = "\n".repeat(100_000) + "const z = 1;";
        let found: boolean | undefined;
        const elapsed = cpuTimeMs(() => {
            found = hasImports(text);
        });
        expect(found).toBe(false);
        expect(elapsed).toBeLessThan(500);
    });
});

describe("extractTraTag", () => {
    test("extracts the filename from a single-line @tra JSDoc", () => {
        expect(extractTraTag("/** @tra smarter_familiars.tra */\nconst x = 1;")).toBe("smarter_familiars.tra");
    });

    test("extracts the filename from inside a multi-line JSDoc block", () => {
        expect(extractTraTag("/**\n * @tra strings.msg\n */\n")).toBe("strings.msg");
    });

    test("returns undefined when no @tra tag is present", () => {
        expect(extractTraTag("const x = 1;\n")).toBeUndefined();
    });
});

describe("makeGeneratedHeader", () => {
    test("verbose form includes the source name and a leading @tra line when given", () => {
        const header = makeGeneratedHeader("foo.tssl", "foo.tra");
        expect(header).toBe(
            "/** @tra foo.tra */\n/* Do not edit. This file is generated from foo.tssl. Make your changes there and regenerate this file. */\n\n",
        );
    });

    test("omits the @tra line when no tag is given", () => {
        expect(makeGeneratedHeader("foo.tssl", undefined)).not.toContain("@tra");
    });

    test("terse form (TD) uses the one-line 'Generated from' wording", () => {
        expect(makeGeneratedHeader("foo.td", undefined, true)).toBe("/* Generated from foo.td - do not edit */\n\n");
    });
});
