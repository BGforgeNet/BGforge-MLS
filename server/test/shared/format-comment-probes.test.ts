/**
 * Comments in every position a tree formatter rebuilds from parts. Each case is a commented input that once lost,
 * merged or moved a comment. The formatter must keep each one where it was written: its result carries no notice
 * (a notice means a comment had to be moved back by the safety net), passes the content guard and is stable.
 */

import { describe, expect, it } from "vitest";
import { BAF, SSL, D, TP2, formatKeepingComments, initFormatParsers, type Language } from "./format-languages";

initFormatParsers();

const LANGUAGES: Record<"ssl" | "baf" | "d" | "tp2", Language> = { ssl: SSL, baf: BAF, d: D, tp2: TP2 };

const inProcedure = (body: string): string => `procedure p begin\n${body}\nend\n`;

const CASES: [keyof typeof LANGUAGES, string, string][] = [
    ["ssl", "paren expr", inProcedure("x := (a /* c */ + b);")],
    ["ssl", "paren expr line", inProcedure("x := (a + // c\n b);")],
    ["ssl", "binary", inProcedure("x := a /* c */ + b;")],
    ["ssl", "ternary", inProcedure("x := a /* c */ if b else c;")],
    ["ssl", "subscript", inProcedure("x := a[/* c */ 1];")],
    ["ssl", "member", inProcedure("x := a./* c */b;")],
    ["ssl", "unary", inProcedure("x := not /* c */ a;")],
    ["ssl", "map", inProcedure("x := {1: 2, /* c */ 3: 4};")],
    ["ssl", "map line", inProcedure("x := {1: 2, // c\n 3: 4};")],
    ["ssl", "while cond", inProcedure("while (a /* c */ < b) do begin\n foo;\nend")],
    ["ssl", "for head", inProcedure("for (i := 0; /* c */ i < 5; i++) begin\n foo;\nend")],
    ["ssl", "foreach head", inProcedure("foreach x in /* c */ arr begin\n foo;\nend")],
    ["ssl", "return", inProcedure("return /* c */ 5;")],
    ["ssl", "variable decl", inProcedure("variable a /* c */, b;")],
    ["ssl", "variable block", "variable begin\n a; // c\n b; /* d */\nend\n"],
    ["ssl", "proc params", "procedure p(variable a /* c */, variable b) begin\nend\n"],
    ["ssl", "proc params line", "procedure p(variable a, // c\n variable b) begin\nend\n"],
    ["ssl", "proc header comment", "procedure p /* c */ begin\nend\n"],
    ["ssl", "proc fwd", "procedure p; // c\nprocedure q;\n"],
    ["ssl", "forward block", "import procedure begin\n a; // c\n b; /* d */\nend\n"],
    ["ssl", "forward block open", "import procedure begin // c\n a;\nend // d\n"],
    [
        "ssl",
        "switch case",
        inProcedure("switch x begin\n case 1: // c\n foo;\n case 2: /* d */ bar;\n default: // e\n baz;\nend"),
    ],
    ["ssl", "call stmt", inProcedure("call foo in /* c */ 5;")],
    ["ssl", "call stmt when", inProcedure("call foo when /* c */ a;")],
    ["ssl", "assignment", inProcedure("x /* c */ := 5; // d")],
    ["ssl", "assignment value", inProcedure("x := /* c */ 5;")],
    ["ssl", "if empty block", inProcedure("if a then begin // c\nend")],
    ["ssl", "else if chain", inProcedure("if a then begin\n x;\nend // c\nelse // d\nbegin\n y;\nend")],
    ["ssl", "define", "#define X 1 // c\n#define Y 2 /* d */\n"],
    ["ssl", "define multi", "#define X(a) \\\n   foo(a) /* c */ \\\n   bar // d\n"],
    ["ssl", "include", '#include "a.h" // c\n'],
    ["ssl", "export", "export variable begin\n a; // c\nend\n"],
    ["ssl", "end comments", inProcedure("foo;\n// last")],
    ["ssl", "two on a row", inProcedure("foo; /* a */ // b")],
    ["ssl", "comment-only file", "// only\n"],
    [
        "baf",
        "cond between or",
        "IF\n  OR(2) // c\n  True() /* d */\n  False()\nTHEN\n  RESPONSE #100 // e\n    Foo() // f\nEND\n",
    ],
    [
        "baf",
        "comment between blocks",
        "IF\n  True()\nTHEN\n  RESPONSE #100\n    Foo()\nEND\n// c\nIF\n  True()\nTHEN\n  RESPONSE #100\n    Foo()\nEND\n",
    ],
    ["baf", "comment in then", "IF\n  True()\nTHEN\n  // c\n  RESPONSE #100\n    // d\n    Foo()\n    // e\nEND\n"],
    ["baf", "comment weight", "IF\n  True()\nTHEN\n  RESPONSE /* c */ #100\n    Foo()\nEND\n"],
    ["baf", "comment after if", "IF // c\n  True()\n  // d\nTHEN\n  RESPONSE #100\n    Foo()\nEND\n"],
    ["baf", "negation comment", "IF\n  !/* c */True()\nTHEN\n  RESPONSE #100\n    Foo()\nEND\n"],
    ["d", "state weight long", `BEGIN ~d~\nIF WEIGHT #1 ~${"x".repeat(120)}~ THEN s1 SAY ~a~ IF ~~ THEN EXIT END\n`],
    ["d", "say multi", "BEGIN ~d~\nIF ~~ THEN s1 SAY ~a~ /* c */ = ~b~ IF ~~ THEN EXIT END\n"],
    ["d", "say comment line", "BEGIN ~d~\nIF ~~ THEN s1 SAY ~a~ // c\n IF ~~ THEN EXIT END\n"],
    [
        "d",
        "transition comments",
        "BEGIN ~d~\nIF ~~ THEN s1 SAY ~a~\n // c\n IF ~~ THEN /* d */ REPLY ~r~ // e\n EXIT\n // f\nEND\n",
    ],
    ["d", "copy trans", "BEGIN ~d~\nIF ~~ THEN s1 SAY ~a~ COPY_TRANS /* c */ dlg s2 // d\nEND\n"],
    ["d", "extend", "EXTEND_BOTTOM dlg 5\n // c\n IF ~~ THEN /* d */ EXIT // e\n // f\nEND\n"],
    ["d", "chain", "CHAIN dlg s1 ~a~ // c\n== dlg2 ~b~ /* d */\nEXIT\n"],
    ["d", "append header", "APPEND /* c */ ~d~ // e\nIF ~~ THEN s1 SAY ~a~ IF ~~ THEN EXIT END\nEND\n"],
    ["d", "begin", "BEGIN ~d~ // c\nIF ~~ THEN s1 SAY ~a~ IF ~~ THEN EXIT END // d\n // e\n"],
    ["d", "replace_say", "REPLACE_SAY dlg s1 /* c */ ~x~ // d\n"],
    ["d", "interject", "INTERJECT dlg s1 var // c\n== dlg ~a~\nEND dlg s2 // d\n"],
    [
        "tp2",
        "function def",
        "BEGIN ~c~\nDEFINE_ACTION_FUNCTION f\nINT_VAR\n  a = 1 // c\n  b = 2 /* d */\nSTR_VAR\n  s = ~x~ // e\nRET r\nBEGIN\n  PRINT ~x~ // f\nEND\n",
    ],
    ["tp2", "function call", "BEGIN ~c~\nLAF f\nINT_VAR\n  a = 1 // c\nSTR_VAR\n  s = ~x~ /* d */\nEND\n"],
    [
        "tp2",
        "match",
        "BEGIN ~c~\nACTION_MATCH ~x~ WITH\n  a // c\n  b BEGIN // d\n    PRINT ~y~\n  END\n  DEFAULT // e\n  PRINT ~z~\nEND\n",
    ],
    [
        "tp2",
        "assoc array",
        "BEGIN ~c~\nACTION_DEFINE_ASSOCIATIVE_ARRAY arr BEGIN\n  a => 1 // c\n  b => 2 /* d */\nEND\n",
    ],
    ["tp2", "define array", "BEGIN ~c~\nACTION_DEFINE_ARRAY arr BEGIN\n  a // c\n  b /* d */\nEND\n"],
    ["tp2", "for", "BEGIN ~c~\nOUTER_FOR (i = 0; /* c */ i < 5; i += 1) BEGIN\n  PRINT ~x~\nEND\n"],
    ["tp2", "while", "BEGIN ~c~\nOUTER_WHILE (1 = 1 /* c */) BEGIN\n  PRINT ~x~\nEND\n"],
    ["tp2", "try", "BEGIN ~c~\nACTION_TRY // c\n  PRINT ~x~ // d\nWITH DEFAULT // e\n  PRINT ~y~\nEND\n"],
    ["tp2", "inner action", "BEGIN ~c~\nCOPY ~a~ ~b~\n  INNER_ACTION BEGIN // c\n    PRINT ~x~ /* d */\n  END\n"],
    [
        "tp2",
        "copy patches",
        "BEGIN ~c~\nCOPY ~a~ ~b~ // c\n  WRITE_BYTE 0 1 // d\n  /* e */ WRITE_BYTE 1 2\n  BUT_ONLY // f\n",
    ],
    ["tp2", "copy header ml", "BEGIN ~c~\nCOPY_EXISTING /* c */ ~a~ ~b~ // d\n  ~e~ ~f~ // g\n"],
    [
        "tp2",
        "quick menu",
        "BACKUP ~x~\nAUTHOR ~y~\nQUICK_MENU\n  ALWAYS_ASK // a\n  END\n  ~menu~ BEGIN // b\n    1 // c\n  END\nEND\nBEGIN ~c~\nPRINT ~x~\n",
    ],
    ["tp2", "always", "ALWAYS // c\n  PRINT ~x~ // d\nEND\n"],
    ["tp2", "directives", "BACKUP ~x~ // c\nAUTHOR ~y~ /* d */\nVERSION ~v~ // e\n"],
    [
        "tp2",
        "component flags",
        "BEGIN ~c~ // a\n  DESIGNATED 1 // b\n  LABEL ~l~ /* c */\n  REQUIRE_PREDICATE (1 = 1) ~m~ // d\n  PRINT ~x~\n",
    ],
    [
        "tp2",
        "action_if else",
        "BEGIN ~c~\nACTION_IF (1 = 1) // a\nBEGIN // b\n  PRINT ~x~ // c\nEND // d\nELSE // e\nBEGIN // f\n  PRINT ~y~\nEND // g\n",
    ],
    [
        "tp2",
        "patch_if cond",
        "BEGIN ~c~\nCOPY ~a~ ~b~\n  PATCH_IF (1 = 1 // a\n   AND 2 = 2 /* b */) BEGIN // c\n    WRITE_BYTE 0 1\n  END\n",
    ],
    ["tp2", "simple multi-line", "BEGIN ~c~\nOUTER_SPRINT x ~a~ // c\nOUTER_SET y = 1 /* d */ + 2\n"],
    [
        "tp2",
        "patch_for_each no in",
        "BEGIN ~c~\nCOPY ~a~ ~b~\n  PATCH_PHP_EACH ~x~ AS k => v // c\n  BEGIN // d\n    PATCH_PRINT ~x~ // e\n  END\n",
    ],
    ["tp2", "replace_bcs", "BEGIN ~c~\nEXTEND_TOP ~a.bcs~ ~b.baf~ // c\nCOMPILE ~x.baf~ // d\n"],
    ["tp2", "inlined file", "BEGIN ~c~\nCOPY ~a~ ~b~\n  REPLACE_TEXTUALLY ~x~ ~y~ // c\n"],
    [
        "tp2",
        "add_spell",
        "BEGIN ~c~\nADD_SPELL ~x.spl~ 1 2 ~y~ // c\n  IF_EXISTING /* d */ WRITE_BYTE 0 1 // e\n  END\n",
    ],
    // Comments the formatter writes in an order other than the source's, once read as lost and written twice.
    ["ssl", "comment before begin and one after it", "procedure foo /* a */ begin // c\n  return 1;\nend\n"],
    ["tp2", "call item, block then line comment", "BEGIN ~c~\nLAF f INT_VAR a /* k */ = // v\n 1 END\n"],
    [
        "tp2",
        "assoc entry, block then line comment",
        "BEGIN ~c~\nACTION_DEFINE_ASSOCIATIVE_ARRAY arr BEGIN\n  ~a~ /* k */ => // v\n ~b~\nEND\n",
    ],
    [
        "tp2",
        "assoc entry, then a multi-line string and a comment",
        "BEGIN ~c~\nACTION_DEFINE_ASSOCIATIVE_ARRAY arr BEGIN\n  ~a~ /* k */ => // v\n ~b~\n  ~c~ => ~multi\nline~ /* s */\nEND\n",
    ],
];

describe("comments in a rebuilt position stay where they were written", () => {
    it.each(CASES)("%s: %s", (language, _label, source) => {
        const lang = LANGUAGES[language];
        const result = lang.format(lang.parse(source));
        expect(result.notice).toBeUndefined();
        expect(result.warning).toBeUndefined();
        formatKeepingComments(lang, source);
    });
});

// A file that is not UTF-8 is formatted one character per byte, so a comment may end in a byte JavaScript calls
// whitespace: cp866's `а` is 0xA0 (U+00A0 there), and 0x85 reads as U+0085. They are text, and stay.
const TEXT_BYTES = [0xa0, 0x85].map((code) => String.fromCodePoint(code));

const WITH_TEXT_BYTE: [keyof typeof LANGUAGES, string, string][] = CASES.flatMap(([language, label, source]) =>
    TEXT_BYTES.map((byte): [keyof typeof LANGUAGES, string, string] => [
        language,
        `${label}, U+${byte.codePointAt(0)?.toString(16).padStart(4, "0")}`,
        source.replaceAll(/\/\* (\w) \*\//g, `/* $1${byte} */`).replaceAll(/\/\/ (\w)\n/g, `// $1${byte}\n`),
    ]),
);

describe("a comment ending in a text byte JavaScript calls whitespace keeps it", () => {
    it.each(WITH_TEXT_BYTE)("%s: %s", (language, _label, source) => {
        const lang = LANGUAGES[language];
        const result = lang.format(lang.parse(source));
        expect(result.warning).toBeUndefined();
        formatKeepingComments(lang, source);
    });
});
