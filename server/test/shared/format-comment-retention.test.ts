/**
 * A formatter may move blanks; it must not lose, add or reword a comment. Each case runs the real formatter, then the
 * content guard the server and the CLI apply to its result, and checks the output is stable under a second pass.
 */

import { describe, expect, it } from "vitest";
import { BAF, SSL, D, TP2, formatKeepingComments, initFormatParsers } from "./format-languages";

initFormatParsers();

const bafBlock = (condition: string, action: string): string =>
    `IF\n  ${condition}\nTHEN\n  RESPONSE #100\n    ${action}\nEND\n`;

describe("BAF formatter keeps comments inside a call", () => {
    it("keeps a block comment between arguments", () => {
        const output = formatKeepingComments(BAF, bafBlock("True()", "Foo( 1, /* c */ 2 )"));
        expect(output).toContain("Foo(1, /* c */ 2)");
    });

    it("keeps a block comment before the first argument and after the last", () => {
        const output = formatKeepingComments(BAF, bafBlock("True()", "Foo( /* a */ 1, 2 /* b */ )"));
        expect(output).toContain("Foo(/* a */ 1, 2 /* b */)");
    });

    it("keeps a line comment between arguments, ending its line", () => {
        const output = formatKeepingComments(BAF, bafBlock("True()", "Foo( 1, // c\n 2 )"));
        expect(output).toContain("Foo(1, // c\n");
        expect(output).toContain("2)");
    });

    it("keeps a line comment after the last argument", () => {
        formatKeepingComments(BAF, bafBlock("True()", "Foo( 1, 2 // c\n )"));
    });

    it("keeps a comment in a condition and in a nested call", () => {
        formatKeepingComments(BAF, bafBlock('Global( "a", /* g */ "GLOBAL", 1 )', "Foo( Bar( 1, /* c */ 2 ), 3 )"));
    });

    it("keeps a comment after the ! of a condition and inside an OR marker", () => {
        formatKeepingComments(
            BAF,
            "IF\n  OR(/* a */ 2)\n  !/* b */True()\n  False()\nTHEN\n  RESPONSE #100\n    Foo()\nEND\n",
        );
    });

    it("keeps a comment in an ActionOverride without its closing parenthesis", () => {
        formatKeepingComments(BAF, bafBlock("True()", "ActionOverride( Player1, /* c */ Foo(1) )"));
    });
});

const sslProc = (statement: string): string => `procedure start begin\n${statement}\nend\n`;

describe("SSL formatter keeps comments inside a call or an array", () => {
    it("keeps a block comment between call arguments", () => {
        const output = formatKeepingComments(SSL, sslProc("foo( 1, /* c */ 2 );"));
        expect(output).toContain("foo(1, /* c */ 2);");
    });

    it("keeps a line comment between call arguments, ending its line", () => {
        const output = formatKeepingComments(SSL, sslProc("foo( 1, // c\n 2 );"));
        expect(output).toContain("foo(1, // c\n");
    });

    it("keeps a comment after the last call argument", () => {
        formatKeepingComments(SSL, sslProc("foo( 1, 2 /* c */ );"));
        formatKeepingComments(SSL, sslProc("foo( 1, 2 // c\n );"));
    });

    it("keeps a comment in a call with no argument", () => {
        formatKeepingComments(SSL, sslProc("foo( /* c */ );"));
    });

    it("keeps a block comment between array elements", () => {
        const output = formatKeepingComments(SSL, sslProc("x := [ 1, /* c */ 2 ];"));
        expect(output).toContain("[1, /* c */ 2]");
    });

    it("keeps a line comment between array elements, ending its line", () => {
        formatKeepingComments(SSL, sslProc("x := [ 1, // c\n 2 ];"));
    });

    it("keeps a comment after the last array element", () => {
        formatKeepingComments(SSL, sslProc("x := [ 1, 2 /* c */ ];"));
        formatKeepingComments(SSL, sslProc("x := [ 1, 2 // c\n ];"));
    });

    it("keeps a comment in a call nested in another", () => {
        formatKeepingComments(SSL, sslProc("foo( bar( 1, /* c */ 2 ), 3 );"));
    });

    it("keeps a comment after the begin of a procedure", () => {
        const output = formatKeepingComments(SSL, "procedure p begin //c\n   foo;\nend\n");
        expect(output).toContain("procedure p begin    // c\n");
    });

    it("keeps a comment after the statement of an if without a block", () => {
        const output = formatKeepingComments(SSL, sslProc("if a then\n   foo; //c\nelse\n   bar;"));
        expect(output).toContain("foo;    // c\n    else");
    });

    it("keeps a comment on its own line before an else", () => {
        formatKeepingComments(SSL, sslProc("if a then\n   foo;\n//c\nelse\n   bar;"));
    });

    it("keeps a comment after the statement of an else without a block", () => {
        formatKeepingComments(SSL, sslProc("if a then begin\n foo;\nend else\n   bar; //c\nbaz;"));
    });

    it("keeps a comment between an else and the if it chains to", () => {
        const output = formatKeepingComments(SSL, sslProc("if a then\n   foo;\nelse /* c */ if b then\n   bar;"));
        expect(output).toContain("else /* c */ if b then");
    });

    it("keeps the value of a return that has a comment before it", () => {
        const output = formatKeepingComments(SSL, sslProc("return /* c */ 5;"));
        expect(output).toContain("return /* c */ 5;");
    });

    it("keeps a block comment between an else and its block", () => {
        const output = formatKeepingComments(SSL, sslProc("if a then\n   foo;\nelse /* c */ begin\n   bar;\nend"));
        expect(output).toContain("else /* c */ begin");
    });

    it("keeps a comment between a then and its statement", () => {
        formatKeepingComments(SSL, sslProc("if a then //c\n   foo;"));
    });

    it("keeps a comment inside a condition", () => {
        formatKeepingComments(SSL, sslProc("if ((a) or /* c */ (b)) then begin\n foo;\nend"));
        formatKeepingComments(SSL, sslProc("if ((a) or // c\n (b)) then begin\n foo;\nend"));
    });

    it("keeps a comment inside a switch", () => {
        formatKeepingComments(SSL, sslProc("switch x begin\n //c\n case 1: foo;\n //d\n end"));
    });

    it("keeps a comment in a call broken over several lines", () => {
        const long = "a_long_argument_name_to_force_a_break";
        formatKeepingComments(SSL, sslProc(`foo( ${long}_1, /* c */ ${long}_2, ${long}_3, ${long}_4 );`));
    });
});

const tp2Component = (body: string): string => `BEGIN ~c~\n${body}\n`;

describe("TP2 formatter keeps comments in a statement it rebuilds", () => {
    it("keeps a block comment among the items of ACTION_FOR_EACH", () => {
        formatKeepingComments(TP2, tp2Component("ACTION_FOR_EACH var IN a /*c*/ b BEGIN\n  PRINT ~x~\nEND"));
    });

    it("keeps the line comments after the items of ACTION_FOR_EACH", () => {
        formatKeepingComments(
            TP2,
            tp2Component("ACTION_FOR_EACH item IN\n  a //one\n  b //two\nBEGIN\n  PRINT ~x~\nEND"),
        );
    });

    it("keeps the line comments after the items of PATCH_FOR_EACH", () => {
        const patch =
            "COPY_EXISTING ~a.itm~ ~override~\n  PATCH_FOR_EACH r IN\n    a //one\n    b //two\n  BEGIN\n    PATCH_PRINT ~x~\n  END";
        formatKeepingComments(TP2, tp2Component(patch));
    });

    it("keeps a comment between a condition and THEN", () => {
        const patch =
            "COPY_EXISTING ~a.itm~ ~override~\n  PATCH_IF (1 = 1)\n    /*c*/ THEN BEGIN\n    WRITE_BYTE 0 1\n  END";
        formatKeepingComments(TP2, tp2Component(patch));
    });

    it("keeps a comment on its own line before ELSE", () => {
        formatKeepingComments(
            TP2,
            tp2Component("ACTION_IF (1 = 1) BEGIN\n  PRINT ~a~\nEND\n// c\nELSE BEGIN\n  PRINT ~b~\nEND"),
        );
    });

    it("keeps the commented-out lines of a COPY_LARGE list", () => {
        formatKeepingComments(TP2, tp2Component("COPY_LARGE ~a~ ~b~\n  //~c~ ~d~\n  ~e~ ~f~"));
    });

    it("keeps a comment after a COPY line", () => {
        formatKeepingComments(TP2, tp2Component("COPY ~a~ ~b~    // note"));
    });

    it("keeps consecutive commented-out pairs of a COPY_LARGE list on lines of their own", () => {
        const output = formatKeepingComments(
            TP2,
            tp2Component("COPY_LARGE ~a~ ~b~\n  //~c~ ~d~\n  //~e~ ~f~\n  ~g~ ~h~"),
        );
        expect(output).toContain("~a~ ~b~  // ~c~ ~d~\n    // ~e~ ~f~\n    ~g~ ~h~");
    });

    it("keeps the comments between an END and its ELSE on lines of their own", () => {
        const output = formatKeepingComments(
            TP2,
            tp2Component(
                "ACTION_IF (1 = 1) BEGIN\n  PRINT ~a~\nEND\n// one\n// two\nELSE ACTION_IF (2 = 2) BEGIN\n  PRINT ~b~\nEND",
            ),
        );
        expect(output).toContain("// one\n// two\nELSE");
    });

    it("keeps the case values that follow a line comment in a match case header", () => {
        const output = formatKeepingComments(
            TP2,
            tp2Component("ACTION_MATCH ~x~ WITH\n  a // c\n  b BEGIN\n    PRINT ~y~\n  END\nDEFAULT\n  PRINT ~z~\nEND"),
        );
        expect(output).toContain("a // c\n    b BEGIN");
    });

    it("keeps a comment between ELSE and the IF it chains to", () => {
        formatKeepingComments(
            TP2,
            tp2Component(
                "ACTION_IF (1 = 1) BEGIN\n  PRINT ~a~\nEND ELSE // c\nACTION_IF (2 = 2) BEGIN\n  PRINT ~b~\nEND",
            ),
        );
    });

    it("keeps each comment among the items of a for-each where it was written", () => {
        const output = formatKeepingComments(
            TP2,
            tp2Component("ACTION_FOR_EACH var IN a /*c*/ b // d\n  e\nBEGIN\n  PRINT ~x~\nEND"),
        );
        expect(output).toContain("IN\n    a /* c */ b // d\n    e\nBEGIN");
    });
});

describe("D formatter keeps comments in a state it rebuilds", () => {
    it("keeps comments between the states of an APPEND", () => {
        formatKeepingComments(
            D,
            "APPEND ~d~\n//\n//a\n//\n\n/* b */\nIF ~~ THEN s1 SAY ~x~ IF ~~ THEN EXIT END\nEND\n",
        );
    });

    it("keeps a comment trailing the END of a state", () => {
        formatKeepingComments(
            D,
            "APPEND ~d~\nIF ~~ THEN s1 SAY ~x~ IF ~~ THEN EXIT END //after\n\nIF ~~ THEN s2 SAY ~y~ IF ~~ THEN EXIT END\nEND\n",
        );
    });

    it("keeps a comment in a state too long for one line", () => {
        const say = "x".repeat(130);
        formatKeepingComments(D, `APPEND ~d~\nIF ~~ THEN s1 SAY ~${say}~ /* c */ IF ~~ THEN EXIT END\nEND\n`);
    });

    it("keeps THEN and BEGIN in a state too long for one line", () => {
        const say = "x".repeat(130);
        const output = formatKeepingComments(
            D,
            `APPEND ~d~\nIF ~~ THEN BEGIN s1 SAY ~${say}~ IF ~~ THEN EXIT END\nEND\n`,
        );
        expect(output).toContain("IF ~~ THEN BEGIN s1");
    });
});
