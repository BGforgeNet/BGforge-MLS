/**
 * One test per position where a formatter rebuilds a construct from its parts and a comment can sit between two of
 * them. The comment must come out where it was written (or, for a line comment, where its line now ends), the
 * formatter must not report that it had to move it, and a second pass must change nothing.
 */

import { describe, expect, it } from "vitest";
import { BAF, D, SSL, TP2, formatKeepingComments, initFormatParsers, type Language } from "./format-languages";

initFormatParsers();

/** Formats `input` and expects exactly `expected`, with no rescue notice, the guard silent and a stable result. */
function expectInPlace(language: Language, input: string, expected: string): void {
    const result = language.format(language.parse(input));
    expect(result.notice).toBeUndefined();
    expect(result.warning).toBeUndefined();
    expect(result.text).toBe(expected);
    formatKeepingComments(language, input);
}

const proc = (body: string): string => `procedure p begin\n${body}\nend\n`;

describe("SSL expressions keep the comments among their parts", () => {
    it.each([
        ["binary, before the operator", "x := a /* c */ + b;", "    x := a /* c */ + b;"],
        ["binary, after the operator", "x := a + /* c */ b;", "    x := a + /* c */ b;"],
        ["binary, line comment after the operator", "x := a + // c\n b;", "    x := a + // c\n         b;"],
        ["binary, line comment before the operator", "x := a // c\n + b;", "    x := a // c\n         + b;"],
        ["parenthesised", "x := (a /* c */ + b);", "    x := (a /* c */ + b);"],
        ["parenthesised, before the closer", "x := (a /* c */);", "    x := (a /* c */);"],
        ["parenthesised, line comment", "x := (a + // c\n b);", "    x := (a + // c\n          b);"],
        ["logical chain", "x := a or /* c */ b or c;", "    x := a or /* c */ b or c;"],
        ["logical chain, line comment", "x := a or // c\n b;", "    x := a\n         or // c\n            b;"],
        ["ternary", "x := a /* c */ if b else c;", "    x := a /* c */ if b else c;"],
        ["subscript", "x := a[/* c */ 1];", "    x := a[/* c */ 1];"],
        ["member", "x := a./* c */b;", "    x := a./* c */ b;"],
        ["unary", "x := not /* c */ a;", "    x := not /* c */ a;"],
        ["unary minus", "x := -/* c */ a;", "    x := - /* c */ a;"],
        ["map entry", "x := {1: 2, /* c */ 3: 4};", "    x := {1: 2, /* c */ 3: 4};"],
        ["map entry parts", "x := {1: /* c */ 2};", "    x := {1: /* c */ 2};"],
        ["map, line comment", "x := {1: 2, // c\n 3: 4};", "    x := {1: 2, // c\n          3: 4};"],
        ["assignment, before the operator", "x /* c */ := 5; // d", "    x /* c */ := 5;    // d"],
        ["assignment, before the value", "x := /* c */ 5;", "    x := /* c */ 5;"],
        ["return", "return /* c */ 5;", "    return /* c */ 5;"],
        ["call statement, delay", "call foo in /* c */ 5;", "    call foo in /* c */ 5;"],
        ["call statement, condition", "call foo when /* c */ a;", "    call foo when /* c */ a;"],
    ])("%s", (_name, body, expected) => {
        expectInPlace(SSL, proc(body), proc(expected));
    });
});

describe("SSL statements keep the comments in their heads", () => {
    it.each([
        [
            "while condition",
            "while (a /* c */ < b) do begin\n foo;\nend",
            "    while (a /* c */ < b) do begin\n        foo;\n    end",
        ],
        [
            "while, before do",
            "while a /* c */ do begin\n foo;\nend",
            "    while a /* c */ do begin\n        foo;\n    end",
        ],
        [
            "while, between do and the statement",
            "while a do\n // c\n foo;",
            "    while a do\n        // c\n        foo;",
        ],
        [
            "for head",
            "for (i := 0; /* c */ i < 5; i++) begin\n foo;\nend",
            "    for (i := 0; /* c */ i < 5; i++) begin\n        foo;\n    end",
        ],
        [
            "foreach head",
            "foreach x in /* c */ arr begin\n foo;\nend",
            "    foreach x in /* c */ arr begin\n        foo;\n    end",
        ],
        ["if, before the condition", "if /* c */ a then\n foo;", "    if /* c */ a then\n        foo;"],
        ["if, before then", "if a /* c */ then\n foo;", "    if a /* c */ then\n        foo;"],
        [
            "if, line comment before then",
            "if a // c\n then begin\n foo;\nend",
            "    if a // c\n    then begin\n        foo;\n    end",
        ],
        ["if, between then and the statement", "if a then\n // c\n foo;", "    if a then\n        // c\n        foo;"],
        ["variable declaration", "variable a /* c */, b;", "    variable a /* c */, b;"],
    ])("%s", (_name, body, expected) => {
        expectInPlace(SSL, proc(body), proc(expected));
    });
});

describe("SSL if keeps a comment written before its then, or after its else, once", () => {
    it.each([
        [
            "before then, on the row of an unblocked branch",
            "if a /* c */ then call f;\n else g();",
            "    if a /* c */ then\n        call f;\n    else\n        g();",
        ],
        [
            "before the condition, on the row of an unblocked branch",
            "if /* c */ a then call f;\n else g();",
            "    if /* c */ a then\n        call f;\n    else\n        g();",
        ],
        [
            "after else, on the row of an unblocked branch",
            "if a then call f;\n else /* c */ g();",
            "    if a then\n        call f;\n    else /* c */ g();",
        ],
    ])("%s", (_name, body, expected) => {
        expectInPlace(SSL, proc(body), proc(expected));
    });
});

describe("SSL declarations keep the comments among their parts", () => {
    it.each([
        [
            "variable block",
            "variable begin\n a; // c\n b; /* d */\nend\n",
            "variable begin\n    a;    // c\n    b;    /* d */\nend\n",
        ],
        ["export block", "export variable begin\n a; // c\nend\n", "export variable begin\n    a;    // c\nend\n"],
        [
            "parameter list",
            "procedure p(variable a /* c */, variable b) begin\nend\n",
            "procedure p(variable a /* c */, variable b) begin\nend\n",
        ],
        [
            "parameter list, line comment",
            "procedure p(variable a, // c\n variable b) begin\nend\n",
            "procedure p(variable a, // c\n    variable b) begin\nend\n",
        ],
    ])("%s", (_name, source, expected) => {
        expectInPlace(SSL, source, expected);
    });
});

describe("BAF keeps a comment after the negation", () => {
    it("keeps it between ! and the condition", () => {
        expectInPlace(
            BAF,
            "IF\n  !/* c */True()\nTHEN\n  RESPONSE #100\n    Foo()\nEND\n",
            "IF\n    ! /* c */ True()\nTHEN\n    RESPONSE #100\n        Foo()\nEND\n",
        );
    });
});

const component = (body: string): string => `BEGIN ~c~\n${body}\n`;
const print = "PRINT ~x~";

describe("TP2 keeps the comments in the head of a loop or a branch", () => {
    it.each([
        [
            "FOR head section",
            `OUTER_FOR (i = 0; /* c */ i < 5; i += 1) BEGIN\n  ${print}\nEND`,
            `OUTER_FOR (i = 0; /* c */ i < 5; i += 1) BEGIN\n    ${print}\nEND`,
        ],
        [
            "FOR, before the parenthesis",
            `OUTER_FOR /* c */ (i = 0; i < 5; i += 1) BEGIN\n  ${print}\nEND`,
            `OUTER_FOR /* c */ (i = 0; i < 5; i += 1) BEGIN\n    ${print}\nEND`,
        ],
        [
            "FOR, before BEGIN",
            `OUTER_FOR (i = 0; i < 5; i += 1) /* c */ BEGIN\n  ${print}\nEND`,
            `OUTER_FOR (i = 0; i < 5; i += 1) /* c */ BEGIN\n    ${print}\nEND`,
        ],
        [
            "WHILE, before BEGIN",
            `OUTER_WHILE (1 = 1) /* c */ BEGIN\n  ${print}\nEND`,
            `OUTER_WHILE (1 = 1) /* c */ BEGIN\n    ${print}\nEND`,
        ],
        [
            "FOR_EACH, before IN",
            `ACTION_FOR_EACH x /* c */ IN a b BEGIN\n  ${print}\nEND`,
            `ACTION_FOR_EACH x /* c */ IN a b BEGIN\n    ${print}\nEND`,
        ],
        [
            "PHP_EACH, after the array",
            `ACTION_PHP_EACH arr /* c */ AS k => v BEGIN\n  ${print}\nEND`,
            `ACTION_PHP_EACH arr /* c */ AS k => v BEGIN\n    ${print}\nEND`,
        ],
        [
            "PHP_EACH, after AS",
            `ACTION_PHP_EACH arr AS /* c */ k => v BEGIN\n  ${print}\nEND`,
            `ACTION_PHP_EACH arr AS /* c */ k => v BEGIN\n    ${print}\nEND`,
        ],
        [
            "PHP_EACH, before the arrow",
            `ACTION_PHP_EACH arr AS k /* c */ => v BEGIN\n  ${print}\nEND`,
            `ACTION_PHP_EACH arr AS k /* c */ => v BEGIN\n    ${print}\nEND`,
        ],
        [
            "PHP_EACH, before BEGIN",
            `ACTION_PHP_EACH arr AS k => v /* c */ BEGIN\n  ${print}\nEND`,
            `ACTION_PHP_EACH arr AS k => v /* c */ BEGIN\n    ${print}\nEND`,
        ],
        [
            "MATCH, before WITH",
            `ACTION_MATCH ~x~ /* c */ WITH\n  a BEGIN\n    ${print}\n  END\n  DEFAULT\n    ${print}\nEND`,
            `ACTION_MATCH ~x~ /* c */\nWITH\n    a BEGIN\n        ${print}\n    END\nDEFAULT\n    ${print}\nEND`,
        ],
        [
            "IF, before the condition",
            `ACTION_IF /* c */ (1 = 1) BEGIN\n  ${print}\nEND`,
            `ACTION_IF /* c */ (1 = 1) BEGIN\n    ${print}\nEND`,
        ],
        [
            "IF, line comment before the condition",
            `ACTION_IF // c\n (1 = 1) BEGIN\n  ${print}\nEND`,
            `ACTION_IF // c\n    (1 = 1)\nBEGIN\n    ${print}\nEND`,
        ],
        [
            "ARRAY, before BEGIN",
            `ACTION_DEFINE_ARRAY arr /* c */ BEGIN\n  a b\nEND`,
            `ACTION_DEFINE_ARRAY arr /* c */ BEGIN\n    a\n    b\nEND`,
        ],
    ])("%s", (_name, body, expected) => {
        expectInPlace(TP2, component(body), component(expected));
    });
});

describe("TP2 keeps a comment after COPY, and one after its file pair", () => {
    it.each([
        [
            "after the keyword, with none after the pair",
            "COPY /* c */ ~a~ ~b~\n  WRITE_BYTE 0 1",
            "COPY ~a~ ~b~  /* c */\n    WRITE_BYTE 0 1",
        ],
        [
            "after the keyword, and a line comment after the pair",
            "COPY /* c */ ~a~ ~b~ // d\n  WRITE_BYTE 0 1",
            "/* c */\nCOPY ~a~ ~b~  // d\n    WRITE_BYTE 0 1",
        ],
        [
            "after the keyword, two line comments before the pair",
            "COPY_EXISTING // c\n  // d\n  ~a~ ~b~\n  WRITE_BYTE 0 1",
            "// c\n// d\nCOPY_EXISTING ~a~ ~b~\n    WRITE_BYTE 0 1",
        ],
    ])("%s", (_name, body, expected) => {
        expectInPlace(TP2, component(body), component(expected));
    });
});

describe("TP2 keeps the comments of a component flag", () => {
    it.each([
        [
            "REQUIRE_PREDICATE, block comment before the predicate",
            "BEGIN @3\nREQUIRE_PREDICATE /* c */ GAME_IS ~bg2~ @30\n",
            "BEGIN @3\nREQUIRE_PREDICATE /* c */ GAME_IS ~bg2~ @30\n",
        ],
        [
            "REQUIRE_PREDICATE, line comment before the predicate",
            "BEGIN @3\nREQUIRE_PREDICATE // c\n GAME_IS ~bg2~ @30\n",
            "BEGIN @3\nREQUIRE_PREDICATE // c\n    GAME_IS ~bg2~ @30\n",
        ],
    ])("%s", (_name, source, expected) => {
        expectInPlace(TP2, source, expected);
    });
});

describe("TP2 keeps the comments of a condition once, after the operand they follow", () => {
    it.each([
        [
            "comment inside an operand",
            `ACTION_IF ((a = 1) AND NOT MOD_IS_INSTALLED /* c */ ~ua.tp2~ ~1~) BEGIN\n  ${print}\nEND`,
            `ACTION_IF ((a = 1)\n    AND NOT MOD_IS_INSTALLED /* c */ ~ua.tp2~ ~1~)\nBEGIN\n    ${print}\nEND`,
        ],
        [
            "comment on a row of its own between operands",
            `ACTION_IF ((a = 1)\n // c\n AND (b = 2)) BEGIN\n  ${print}\nEND`,
            `ACTION_IF ((a = 1)  // c\n    AND (b = 2))\nBEGIN\n    ${print}\nEND`,
        ],
        [
            "comment between the operator and its operand",
            `ACTION_IF ((a = 1) AND /* c */ (b = 2)) BEGIN\n  ${print}\nEND`,
            `ACTION_IF ((a = 1)  /* c */\n    AND (b = 2))\nBEGIN\n    ${print}\nEND`,
        ],
    ])("%s", (_name, body, expected) => {
        expectInPlace(TP2, component(body), component(expected));
    });
});

describe("TP2 keeps a line comment ahead of a name, a condition or a parameter", () => {
    it.each([
        [
            "function name",
            `DEFINE_ACTION_FUNCTION // c\n f BEGIN\n  ${print}\nEND`,
            `DEFINE_ACTION_FUNCTION  // c\n    f BEGIN\n    ${print}\nEND`,
        ],
        [
            "array name",
            "ACTION_DEFINE_ARRAY // c\n arr BEGIN a END",
            "ACTION_DEFINE_ARRAY // c\n    arr\nBEGIN\n    a\nEND",
        ],
        [
            "WHILE condition",
            `OUTER_WHILE // c\n (1 = 1) BEGIN\n  ${print}\nEND`,
            `OUTER_WHILE // c\n    (1 = 1)\nBEGIN\n    ${print}\nEND`,
        ],
        [
            "parameter name before its =",
            `DEFINE_ACTION_FUNCTION g\n  INT_VAR\n    index // c\n      = 0\nBEGIN\n  ${print}\nEND`,
            `DEFINE_ACTION_FUNCTION g\n    INT_VAR\n        // c\n        index = 0\nBEGIN\n    ${print}\nEND`,
        ],
        [
            "parameter value after its =",
            `DEFINE_ACTION_FUNCTION g\n  STR_VAR\n    s = // c\n      ~x~\nBEGIN\n  ${print}\nEND`,
            `DEFINE_ACTION_FUNCTION g\n    STR_VAR\n        // c\n        s = ~x~\nBEGIN\n    ${print}\nEND`,
        ],
        [
            "parameter, block comment around the =",
            `DEFINE_ACTION_FUNCTION g\n  INT_VAR\n    a /* c */ = /* d */ 1\nBEGIN\n  ${print}\nEND`,
            `DEFINE_ACTION_FUNCTION g\n    INT_VAR\n        a /* c */ = /* d */ 1\nBEGIN\n    ${print}\nEND`,
        ],
        [
            "call parameter, block comment before its value",
            `LAF f\n  INT_VAR\n    a = /* c */ 1\nEND`,
            `LAF f\n    INT_VAR\n        a = /* c */ 1\nEND`,
        ],
        [
            "associative array entry, line comment after the arrow",
            "ACTION_DEFINE_ASSOCIATIVE_ARRAY arr BEGIN\n  a => // c\n    1\nEND",
            "ACTION_DEFINE_ASSOCIATIVE_ARRAY arr BEGIN\n    // c\n    a => 1\nEND",
        ],
    ])("%s", (_name, body, expected) => {
        expectInPlace(TP2, component(body), component(expected));
    });

    it.each([
        [
            "REPLACE_BCS_BLOCK header, block comment",
            "R_B_B /* c */ CASE_INSENSITIVE ~x~ ~y~",
            "R_B_B /* c */ CASE_INSENSITIVE ~x~ ~y~",
        ],
        [
            "REPLACE_BCS_BLOCK header, line comment",
            "R_B_B // c\n    CASE_INSENSITIVE ~x~ ~y~",
            "R_B_B // c\n        CASE_INSENSITIVE ~x~ ~y~",
        ],
        [
            "REPLACE_EVALUATE header, line comment",
            "REPLACE_EVALUATE // c\n    CASE_INSENSITIVE ~x~ BEGIN\n    END ~y~",
            "REPLACE_EVALUATE // c\n        CASE_INSENSITIVE ~x~\n    BEGIN\n    END\n    ~y~",
        ],
    ])("%s", (_name, body, expected) => {
        expectInPlace(
            TP2,
            component(`COPY_EXISTING ~a~ ~b~\n  ${body}`),
            component(`COPY_EXISTING ~a~ ~b~\n    ${expected}`),
        );
    });
});

describe("D keeps the comments in the header of an action and in a transition", () => {
    it.each([
        [
            "BEGIN header, line comment before the name",
            "BEGIN // c\n ~d~\nIF ~~ THEN s1 SAY ~a~ IF ~~ THEN EXIT END\n",
            "BEGIN // c\n    ~d~\n    IF ~~ THEN s1 SAY ~a~ IF ~~ THEN EXIT END\n",
        ],
        [
            "APPEND header, comments before and after the name",
            "APPEND /* c */ ~d~ // e\nIF ~~ THEN s1 SAY ~a~ IF ~~ THEN EXIT END\nEND\n",
            "APPEND /* c */ ~d~ // e\n    IF ~~ THEN s1 SAY ~a~ IF ~~ THEN EXIT END\nEND\n",
        ],
        [
            "EXTEND header, line comment before the state",
            "EXTEND_BOTTOM dlg // c\n  5\n  IF ~~ THEN EXIT\nEND\n",
            "EXTEND_BOTTOM dlg // c\n    5\n    IF ~~ THEN EXIT\nEND\n",
        ],
        [
            "transition, line comment after IF",
            "EXTEND_BOTTOM ~ARAN~ 88 IF // c\n ~b~ THEN GOTO a1 END\n",
            "EXTEND_BOTTOM ~ARAN~ 88\n    IF  // c\n        ~b~ THEN GOTO a1\nEND\n",
        ],
    ])("%s", (_name, source, expected) => {
        expectInPlace(D, source, expected);
    });
});

const patchPrint = "PATCH_PRINT ~x~";

describe("TP2 keeps the comments in the head of a patch loop or branch", () => {
    it.each([
        [
            "IF, before the condition",
            `PATCH_IF /* c */ (a = 1) BEGIN\n    ${patchPrint}\n  END`,
            `PATCH_IF /* c */ (a = 1) BEGIN\n        ${patchPrint}\n    END`,
        ],
        [
            "IF, between the condition and THEN",
            `PATCH_IF (a = 1)\n    /* c */\n  THEN BEGIN\n    ${patchPrint}\n  END`,
            `PATCH_IF (a = 1)\n        /* c */\n    THEN BEGIN\n        ${patchPrint}\n    END`,
        ],
        [
            "IF, line comment before the condition",
            `PATCH_IF // c\n (a = 1) BEGIN\n    ${patchPrint}\n  END`,
            `PATCH_IF // c\n        (a = 1)\n    BEGIN\n        ${patchPrint}\n    END`,
        ],
        [
            "FOR_EACH, before IN",
            `PATCH_FOR_EACH x /* c */ IN a b BEGIN\n    ${patchPrint}\n  END`,
            `PATCH_FOR_EACH x /* c */ IN a b BEGIN\n        ${patchPrint}\n    END`,
        ],
        [
            "PHP_EACH, after the array",
            `PATCH_PHP_EACH arr /* c */ AS k => v BEGIN\n    ${patchPrint}\n  END`,
            `PATCH_PHP_EACH arr /* c */ AS k => v BEGIN\n        ${patchPrint}\n    END`,
        ],
        [
            "MATCH, before WITH",
            `PATCH_MATCH ~x~ /* c */ WITH\n    a BEGIN\n      ${patchPrint}\n    END\n    DEFAULT\n      ${patchPrint}\n  END`,
            `PATCH_MATCH ~x~ /* c */\n    WITH\n        a BEGIN\n            ${patchPrint}\n        END\n    DEFAULT\n        ${patchPrint}\n    END`,
        ],
    ])("%s", (_name, body, expected) => {
        expectInPlace(TP2, component(`COPY ~a~ ~b~\n  ${body}`), component(`COPY ~a~ ~b~\n    ${expected}`));
    });
});
