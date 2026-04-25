/**
 * Unit tests for weidu-d/format/core.ts - D file formatter.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { initParser, getParser } from "../../src/weidu-d/parser";
import { formatWeiduD as formatDocument } from "@bgforge/format";

beforeAll(async () => {
    await initParser();
});

function format(input: string): string {
    const parser = getParser();
    const tree = parser.parse(input);
    return formatDocument(tree!.rootNode).text;
}

describe("weidu-d/format/core", () => {
    describe("EXTEND with position number (#N)", () => {
        it("preserves #N without inserting space", () => {
            const input = `EXTEND_TOP %dlg% %START_STATE% #4\n  + ~~ + @1 + g_item_type\nEND\n`;
            const output = format(input);

            expect(output).toContain("EXTEND_TOP %dlg% %START_STATE% #4");
            expect(output).not.toContain("# 4");
        });

        it("preserves #1 in EXTEND_TOP with IF trigger", () => {
            const input = `EXTEND_TOP finmel01 1 #1 IF ~Global("BalthazarFights","GLOBAL",1)~ THEN REPLY @591 GOTO mel1 END\n`;
            const output = format(input);

            expect(output).toContain("#1");
            expect(output).not.toContain("# 1");
        });

        it("preserves #0 in EXTEND_BOTTOM", () => {
            const input = `EXTEND_BOTTOM dlg 5 #0\n  IF ~~ THEN EXIT\nEND\n`;
            const output = format(input);

            expect(output).toContain("#0");
            expect(output).not.toContain("# 0");
        });
    });

    describe("END indentation", () => {
        it("END aligns with IF, not with body content", () => {
            const input = `BEGIN ~dlg~\nIF ~~ THEN BEGIN state\n  SAY ~hello~\n  IF ~~ THEN EXIT\nEND\n`;
            const output = format(input);
            const lines = output.split("\n");

            const ifLine = lines.find((l) => l.trimStart().startsWith("IF ~~ THEN BEGIN"));
            const endLine = lines.find((l) => l.trim() === "END");
            const sayLine = lines.find((l) => l.trimStart().startsWith("SAY"));

            expect(ifLine).toBeDefined();
            expect(endLine).toBeDefined();
            expect(sayLine).toBeDefined();

            // END should be at the same depth as IF (depth 1), one level less than SAY (depth 2)
            const ifIndent = ifLine!.length - ifLine!.trimStart().length;
            const endIndent = endLine!.length - endLine!.trimStart().length;
            const sayIndent = sayLine!.length - sayLine!.trimStart().length;

            expect(endIndent).toBe(ifIndent);
            expect(sayIndent).toBeGreaterThan(endIndent);
        });
    });

    describe("string preservation", () => {
        it("preserves newlines in triggers", () => {
            const input = `BEGIN ~dlg~\nIF ~Global("x",\n"y")~ THEN BEGIN state\n  SAY ~hello~\n  IF ~~ THEN EXIT\nEND\n`;
            const output = format(input);
            // Newline inside string is preserved (string split across lines)
            expect(output).toContain('~Global("x",');
            expect(output).toContain('"y")~');
            expect(output).toContain("\n");
        });

        it("preserves multiple spaces in strings", () => {
            const input = `BEGIN ~dlg~\nIF ~Global("x",  "y")~ THEN BEGIN state\n  SAY ~hello~\n  IF ~~ THEN EXIT\nEND\n`;
            const output = format(input);
            expect(output).toContain('~Global("x",  "y")~');
        });
    });

    describe("separator preservation before literals", () => {
        it("preserves space before string literal on multiline state header", () => {
            // The trigger string contains a newline, so reindentState is used.
            // Code token "IF " gets trimmed to "IF"; the space before ~ must not be lost.
            const input = `BEGIN ~dlg~\nIF ~Global("x",\n"y")~ THEN BEGIN state\n  SAY ~hello~\n  IF ~~ THEN EXIT\nEND\n`;
            const output = format(input);
            expect(output).toMatch(/IF ~/);
        });

        it("preserves space before string literal in SAY expression", () => {
            const input = `BEGIN ~dlg~\nIF ~~ THEN BEGIN state\n  SAY ~hello\nworld~\n  IF ~~ THEN EXIT\nEND\n`;
            const output = format(input);
            expect(output).toMatch(/SAY ~/);
        });

        it("preserves space before line comment after code", () => {
            const input = `BEGIN ~dlg~\nIF ~~ THEN BEGIN state\n  SAY ~hello~ // a comment\n  IF ~~ THEN EXIT\nEND\n`;
            const output = format(input);
            expect(output).toMatch(/SAY ~hello~\s+\/\/ a comment/);
        });

        it("preserves space before standalone comment after code token", () => {
            // EXIT is code, // comment is a comment token — space between them must be preserved
            const input = `BEGIN ~dlg~\nIF ~~ THEN BEGIN state\n  SAY ~hello~\n  IF ~~ THEN EXIT // done\nEND\n`;
            const output = format(input);
            expect(output).toMatch(/EXIT\s+\/\/ done/);
        });
    });

    describe("comment preservation", () => {
        describe("decorative separators", () => {
            it("preserves decorative separator comments without adding space", () => {
                const input = `///////////////////////////////////////////////////////////////////////\n// comment\n///////////////////////////////////////////////////////////////////////\n`;
                const output = format(input);
                expect(output).toContain("///////////////////////////////////////////////////////////////////////");
                expect(output).not.toContain(
                    "// /////////////////////////////////////////////////////////////////////",
                );
            });

            it("preserves shorter decorative separators", () => {
                const input = `////////////\n`;
                const output = format(input);
                expect(output).toContain("////////////");
            });

            it("normalizes regular line comments with space", () => {
                const input = `//regular comment\n`;
                const output = format(input);
                expect(output).toContain("// regular comment");
            });

            it("preserves mixed separator with dashes", () => {
                const input = `// ----------------\n`;
                const output = format(input);
                expect(output).toContain("// ----------------");
            });
        });

        describe("block comments", () => {
            it("preserves whitespace inside block comments", () => {
                const input = `EXTEND_BOTTOM dlg 0\n  IF ~~ THEN EXIT /* comment  with   spaces */\nEND\n`;
                const output = format(input);
                expect(output).toContain("/* comment  with   spaces */");
            });

            it("preserves block comments with double spaces", () => {
                const input = `EXTEND_BOTTOM dlg 0\n  IF ~~ THEN REPLY @1 GOTO state /* ~Oh, please.  I saw you.~ */\nEND\n`;
                const output = format(input);
                expect(output).toContain("/* ~Oh, please.  I saw you.~ */");
            });
        });

        describe("trailing comments", () => {
            it("keeps trailing block comment on same line as code", () => {
                const input = `REPLACE_SAY dlg 1 @1 /* comment */\n`;
                const output = format(input);
                expect(output).toMatch(/REPLACE_SAY dlg 1 @1 \/\* comment \*\//);
            });

            it("keeps trailing line comment on same line as code", () => {
                const input = `EXTEND_BOTTOM dlg 0\n  IF ~~ THEN EXIT // done\nEND\n`;
                const output = format(input);
                expect(output).toMatch(/EXIT\s+\/\/ done/);
            });

            it("preserves END with trailing comment on same line", () => {
                const input = `BEGIN ~dlg~\nIF ~~ THEN BEGIN state\n  SAY ~hello~\nEND /* end */\n`;
                const output = format(input);
                expect(output).toMatch(/END \/\* end \*\//);
            });
        });
    });

    describe("multi-line transitions", () => {
        it("preserves multi-line tilde strings with correct indentation", () => {
            const input = `EXTEND_BOTTOM dlg 0\n  IF ~Global("x",\n"y")~ THEN REPLY @1 GOTO state\nEND\n`;
            const output = format(input);
            expect(output).toContain('~Global("x",');
            expect(output).toContain('"y")~');
        });

        it("is idempotent with multi-line strings", () => {
            const input = `EXTEND_BOTTOM dlg 0\n  IF ~Global("x",\n"y")~ THEN REPLY @1 GOTO state\nEND\n`;
            const first = format(input);
            const second = format(first);
            expect(first).toBe(second);
        });

        it("preserves multi-line action strings", () => {
            const input = `EXTEND_BOTTOM dlg 0\n  IF ~~ THEN REPLY @1 DO ~Action1()\nAction2()\nAction3()~ GOTO state\nEND\n`;
            const output = format(input);
            expect(output).toContain("~Action1()");
            expect(output).toContain("Action2()");
            expect(output).toContain("Action3()~");
        });

        it("is idempotent with multi-line action strings", () => {
            const input = `EXTEND_BOTTOM dlg 0\n  IF ~~ THEN REPLY @1 DO ~Action1()\nAction2()\nAction3()~ GOTO state\nEND\n`;
            const first = format(input);
            const second = format(first);
            expect(first).toBe(second);
        });
    });

    describe("blank line preservation", () => {
        it("preserves blank lines between comments", () => {
            const input = `// comment 1\n\n// comment 2\n\nBEGIN dlg\n`;
            const output = format(input);
            const lines = output.split("\n");
            expect(lines[0]).toContain("// comment 1");
            expect(lines[1]).toBe("");
            expect(lines[2]).toContain("// comment 2");
        });

        it("preserves blank lines between top-level items", () => {
            // Test that blank lines between EXTEND_BOTTOM actions are preserved
            const input = `EXTEND_BOTTOM dlg 1\n  IF ~~ THEN EXIT\nEND\n\nEXTEND_BOTTOM dlg 2\n  IF ~~ THEN EXIT\nEND\n`;
            const output = format(input);
            expect(output).toContain("\n\nEXTEND_BOTTOM dlg 2");
        });
    });
});
