/**
 * Differential: the WeiDU binary is the authority on what D syntax is legal, so every construct the
 * grammar claims to support is checked against `weidu --parse-check d` rather than against our own
 * reading of the docs. A divergence in either direction is a defect:
 *   - WeiDU accepts, we reject  -> a false "Syntax error" on valid syntax
 *   - we accept, WeiDU rejects  -> a real error the user never sees flagged
 *
 * This catches the class the external corpus cannot: a construct no mod in the corpus happens to use is
 * invisible to a corpus sweep, but is still syntax a user can write. It is also the check the .d fixtures
 * lacked - several committed fixtures turned out to be syntax WeiDU rejects, and nothing said so.
 *
 * A handful of divergences are deliberate; those carry a `divergence` note and the case asserts the
 * disagreement STILL HOLDS, so the day WeiDU or the grammar changes its mind the gate says so rather than
 * quietly agreeing. Sibling: weidu-tp2-grammar-differential.test.ts, which does the same for TP2; both
 * find their binary through weidu-binary.ts, which has no skip path.
 */

import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import {
    exitStatus,
    resolveWeidu,
    WEIDU_HOOK_TIMEOUT_MS,
    WEIDU_TIMEOUT_MS,
} from "../../../scripts/utils/src/weidu-binary.ts";
import { initParser, parseWithCache } from "@bgforge/shared/parsers/weidu-d";

/**
 * The words the grammar reserves, read from the generated grammar.json: its `reserved` set is the RESERVED_WORDS
 * list in grammar.js. Not skipped when absent - this suite needs a built grammar anyway.
 */
const GRAMMAR_RESERVED_WORDS =
    (
        JSON.parse(readFileSync(path.resolve(__dirname, "../../../grammars/weidu-d/src/grammar.json"), "utf8")) as {
            reserved?: { global?: { value: string }[] };
        }
    ).reserved?.global?.map((rule) => rule.value) ?? [];

/**
 * WeiDU exits 0 when the file parsed and 4 on a parse error. Anything else (crash, missing binary,
 * a WeiDU-side timeout) is not a verdict about the snippet, so it is reported rather than counted.
 */
const WEIDU_OK = 0;
const WEIDU_PARSE_ERROR = 4;

interface Case {
    name: string;
    code: string;
    /**
     * Set only where we KNOWINGLY disagree with WeiDU. The case then asserts the disagreement is still
     * there; an entry that starts agreeing is as much a finding as one that stops.
     */
    divergence?: string;
}

/** A complete .d file. WeiDU parses an action list, so most constructs are one top-level action. */
const file = (body: string) => `${body}\n`;

/** A construct that lives in a state's transition list. */
const inState = (body: string) => `BEGIN ~dlg~\nIF ~~ THEN BEGIN st\n  SAY ~hi~\n  ${body}\nEND\n`;

/** A construct that lives in a state's SAY slot. */
const asSayText = (text: string) => `BEGIN ~dlg~\nIF ~~ THEN BEGIN st\n  SAY ${text}\n  IF ~~ THEN EXIT\nEND\n`;

/** A construct that stands where a state label goes. */
const asLabel = (label: string) => `BEGIN ~dlg~\nIF ~~ THEN BEGIN ${label}\n  SAY ~hi~\n  IF ~~ THEN EXIT\nEND\n`;

/** One case per construct this grammar claims, kept in context helpers so a case cannot test the wrapper. */
const CASES: Case[] = [
    // Controls. Without these a template mistake reads as every construct being broken, so the pair is
    // part of the suite rather than a one-off check.
    { name: "control: a minimal dialogue parses", code: inState("IF ~~ THEN EXIT") },
    { name: "control: bogus tokens are rejected", code: file("NOT_A_KEYWORD ~a~ ~b~ !!!") },

    // Dialogue-defining actions.
    { name: "BEGIN", code: file("BEGIN ~dlg~") },
    { name: "BEGIN with a non-pausing flag", code: file("BEGIN ~dlg~ 1") },
    { name: "APPEND", code: file("APPEND ~dlg~\nIF ~~ THEN BEGIN st\n  SAY ~hi~\n  IF ~~ THEN EXIT\nEND\nEND") },
    { name: "APPEND_EARLY", code: file("APPEND_EARLY ~dlg~\nEND") },
    { name: "APPEND IF_FILE_EXISTS", code: file("APPEND IF_FILE_EXISTS ~dlg~\nEND") },
    { name: "REPLACE", code: file("REPLACE ~dlg~\nIF ~~ THEN BEGIN st\n  SAY ~hi~\n  IF ~~ THEN EXIT\nEND\nEND") },
    { name: "EXTEND_TOP", code: file("EXTEND_TOP ~dlg~ 0\n  IF ~~ THEN EXIT\nEND") },
    { name: "EXTEND_BOTTOM", code: file("EXTEND_BOTTOM ~dlg~ 0\n  IF ~~ THEN EXIT\nEND") },
    { name: "EXTEND_TOP with a #position", code: file("EXTEND_TOP ~dlg~ 0 #1\n  IF ~~ THEN EXIT\nEND") },

    // CHAIN and the INTERJECT family.
    { name: "CHAIN", code: file("CHAIN ~a~ st\n~line~\n== ~b~ ~line two~\nEXIT") },
    { name: "CHAIN3", code: file("CHAIN3 ~a~ st\n~line~\n== ~b~ ~line two~\nEXIT") },
    { name: "CHAIN with IF WEIGHT trigger THEN", code: file("CHAIN IF WEIGHT #-1 ~trig~ THEN ~a~ st\n~line~\nEXIT") },
    { name: "CHAIN ending END file label", code: file("CHAIN ~a~ st\n~line~\nEND ~b~ next") },
    { name: "CHAIN ending EXTERN", code: file("CHAIN ~a~ st\n~line~\nEXTERN ~b~ next") },
    { name: "CHAIN ending COPY_TRANS", code: file("CHAIN ~a~ st\n~line~\nCOPY_TRANS ~b~ next") },
    { name: "CHAIN ending END plus transitions", code: file("CHAIN ~a~ st\n~line~\nEND\nIF ~~ THEN EXIT") },
    { name: "CHAIN with a DO action", code: file('CHAIN ~a~ st\n~line~\nDO ~SetGlobal("g","GLOBAL",1)~\nEXIT') },
    { name: "CHAIN with BRANCH", code: file("CHAIN ~a~ st\n~line~\nBRANCH ~trig~ BEGIN\n== ~b~ ~x~\nEND\nEXIT") },
    { name: "INTERJECT", code: file("INTERJECT ~a~ st gvar\n== ~b~ ~line~\nEND ~c~ next") },
    { name: "INTERJECT_COPY_TRANS", code: file("INTERJECT_COPY_TRANS ~a~ st gvar\n== ~b~ ~line~\nEND") },
    { name: "INTERJECT_COPY_TRANS2", code: file("INTERJECT_COPY_TRANS2 ~a~ st gvar\n== ~b~ ~line~\nEND") },
    { name: "INTERJECT_COPY_TRANS3", code: file("INTERJECT_COPY_TRANS3 ~a~ st gvar\n== ~b~ ~line~\nEND") },
    { name: "INTERJECT_COPY_TRANS4", code: file("INTERJECT_COPY_TRANS4 ~a~ st gvar\n== ~b~ ~line~\nEND") },
    { name: "alias I_C_T", code: file("I_C_T ~a~ st gvar\n== ~b~ ~line~\nEND") },
    { name: "alias I_C_T2", code: file("I_C_T2 ~a~ st gvar\n== ~b~ ~line~\nEND") },
    { name: "INTERJECT_COPY_TRANS with SAFE", code: file("INTERJECT_COPY_TRANS SAFE ~a~ st gvar\n== ~b~ ~x~\nEND") },

    // Text-replacement actions.
    { name: "REPLACE_ACTION_TEXT", code: file("REPLACE_ACTION_TEXT ~dlg~ ~old~ ~new~") },
    { name: "REPLACE_ACTION_TEXT_REGEXP", code: file("REPLACE_ACTION_TEXT_REGEXP ~re~ ~old~ ~new~") },
    { name: "REPLACE_ACTION_TEXT_PROCESS", code: file("REPLACE_ACTION_TEXT_PROCESS ~dlg~ ~old~ ~new~") },
    { name: "alias R_A_T_P_R", code: file("R_A_T_P_R ~dlg~ ~old~ ~new~") },
    { name: "REPLACE_TRIGGER_TEXT", code: file("REPLACE_TRIGGER_TEXT ~dlg~ ~old~ ~new~") },
    { name: "REPLACE_TRIGGER_TEXT_REGEXP", code: file("REPLACE_TRIGGER_TEXT_REGEXP ~re~ ~old~ ~new~") },
    { name: "REPLACE_SAY", code: file("REPLACE_SAY ~dlg~ 0 ~text~") },
    { name: "REPLACE_STATE_TRIGGER", code: file("REPLACE_STATE_TRIGGER ~dlg~ 0 ~trig~") },
    { name: "SET_WEIGHT", code: file("SET_WEIGHT ~dlg~ 0 #-1") },

    // BEGIN/END list actions.
    { name: "ALTER_TRANS", code: file("ALTER_TRANS ~dlg~ BEGIN 0 END BEGIN 0 END BEGIN ACTION ~x~ END") },
    { name: "REPLACE_TRANS_TRIGGER", code: file("REPLACE_TRANS_TRIGGER ~dlg~ BEGIN 0 END BEGIN 0 END ~old~ ~new~") },
    { name: "REPLACE_TRANS_ACTION", code: file("REPLACE_TRANS_ACTION ~dlg~ BEGIN 0 END BEGIN 0 END ~old~ ~new~") },
    { name: "ADD_TRANS_ACTION", code: file("ADD_TRANS_ACTION ~dlg~ BEGIN 0 END BEGIN 0 END ~act~") },
    {
        name: "ADD_TRANS_ACTION with a trailing UNLESS",
        code: file("ADD_TRANS_ACTION ~dlg~ BEGIN 0 END BEGIN 0 END ~act~ UNLESS ~x~"),
    },
    { name: "ADD_STATE_TRIGGER", code: file("ADD_STATE_TRIGGER ~dlg~ 0 ~trig~") },
    { name: "ADD_STATE_TRIGGER with several states", code: file("ADD_STATE_TRIGGER ~dlg~ 0 ~trig~ 1 2") },
    { name: "ADD_TRANS_TRIGGER", code: file("ADD_TRANS_TRIGGER ~dlg~ 0 ~trig~") },
    { name: "ADD_TRANS_TRIGGER with DO numbers", code: file("ADD_TRANS_TRIGGER ~dlg~ 0 ~trig~ DO 1 2") },
    { name: "an IF guard on a patch action", code: file("ADD_STATE_TRIGGER ~dlg~ 0 IF ~cond~ ~trig~") },

    // Transitions and their features.
    { name: "transition with GOTO", code: inState("IF ~~ THEN GOTO other") },
    { name: "transition shorthand + trigger + reply", code: inState("+ ~trig~ + ~reply~ EXIT") },
    { name: "transition shorthand goto", code: inState("IF ~~ THEN EXIT\n  + other") },
    { name: "REPLY feature", code: inState("IF ~~ THEN REPLY ~text~ EXIT") },
    { name: "DO feature", code: inState('IF ~~ THEN DO ~SetGlobal("g","GLOBAL",1)~ EXIT') },
    { name: "JOURNAL feature", code: inState("IF ~~ THEN JOURNAL ~entry~ EXIT") },
    { name: "SOLVED_JOURNAL feature", code: inState("IF ~~ THEN SOLVED_JOURNAL ~entry~ EXIT") },
    { name: "UNSOLVED_JOURNAL feature", code: inState("IF ~~ THEN UNSOLVED_JOURNAL ~entry~ EXIT") },
    { name: "FLAGS feature", code: inState("IF ~~ THEN FLAGS 4 EXIT") },
    { name: "EXTERN next", code: inState("IF ~~ THEN EXTERN ~other~ st2") },
    { name: "EXTERN IF_FILE_EXISTS", code: inState("IF ~~ THEN EXTERN IF_FILE_EXISTS ~other~ st2") },
    { name: "COPY_TRANS as a standalone transition", code: inState("COPY_TRANS ~other~ st2") },
    { name: "COPY_TRANS_LATE", code: inState("COPY_TRANS_LATE ~other~ st2") },
    { name: "COPY_TRANS with SAFE", code: inState("COPY_TRANS SAFE ~other~ st2") },
    {
        name: "a state carrying a WEIGHT",
        code: file("BEGIN ~dlg~\nIF WEIGHT #-1 ~~ THEN BEGIN st\n  SAY ~hi~\n  IF ~~ THEN EXIT\nEND"),
    },

    // Text slots.
    { name: "say text as a tra reference", code: asSayText("@1") },
    { name: "say text as a strref", code: asSayText("#1") },
    { name: "say text as a double-quoted string", code: asSayText('"hi"') },
    { name: "multisay: SAY a = b = c", code: asSayText("~one~ = ~two~ = ~three~") },
    {
        name: "say text as %var%",
        code: asSayText("%kivan17%"),
    },
    // A text slot holds a male text and an optional female one, each with an optional [sound] and each a
    // run of strings joined by ^; a !strref in front forces the text into that strref.
    { name: "say text with a female variant", code: asSayText("~m~ ~f~") },
    { name: "say text with a sound", code: asSayText("~m~ [SND01]") },
    { name: "male and female say text with sounds", code: asSayText("~m~ [A] ~f~ [B]") },
    { name: "female say text with a sound", code: asSayText("~m~ ~f~ [B]") },
    { name: "concatenated say text", code: asSayText("~m~ ^ ~n~") },
    { name: "concatenated male and female say text", code: asSayText('~a~ ^ "b" ~c~ ^ %d%') },
    { name: "say text forced into a strref", code: asSayText("!5 ~m~") },
    { name: "say text forced into a negative strref", code: asSayText("!-1 ~m~ ~f~") },
    { name: "say text as a negative tra reference", code: asSayText("@-1") },
    { name: "say text as a negative strref", code: asSayText("#-1") },
    { name: "say text as (AT tilde string)", code: asSayText("(AT ~foo~)") },
    { name: "say text as (AT double string)", code: asSayText('(AT "foo")') },
    { name: "say text as (AT bare word)", code: asSayText("(AT foo)") },
    { name: "a sound after a tra reference is rejected", code: asSayText("@1 [SND]") },
    { name: "a third string in a text slot is rejected", code: asSayText("~a~ ~b~ ~c~") },
    { name: "REPLY with a female variant", code: inState("IF ~~ THEN REPLY ~a~ ~b~ EXIT") },
    { name: "short transition reply with a sound", code: inState("+ ~~ + ~a~ [SND] EXIT") },
    { name: "JOURNAL with a sound", code: inState("IF ~~ THEN JOURNAL ~a~ [S] EXIT") },
    { name: "REPLACE_SAY with a female variant", code: file("REPLACE_SAY ~dlg~ 0 ~a~ ~b~") },
    { name: "REPLACE_SAY with a sound", code: file("REPLACE_SAY ~dlg~ 0 ~a~ [S]") },
    { name: "CHAIN text with a sound", code: file("CHAIN ~a~ st\n~m~ [SND]\nEXIT") },
    { name: "%var% with a dash as say text", code: asSayText("%a-b%") },
    { name: "%var% with a leading digit as say text", code: asSayText("%1a%") },
    { name: "%var% with a dot as a dialog name", code: file("SET_WEIGHT %a.b% 0 #1") },
    {
        name: "%var% with a space is rejected although WeiDU accepts it",
        code: asSayText("%a b%"),
        divergence:
            "A %...% run stops at whitespace here, as in the TP2 grammar, so a % still being typed cannot run " +
            "on to the next % lines away and swallow everything between; WeiDU reads to the next % whatever " +
            "lies between.",
    },

    // A #weight or #position is one token: WeiDU has no `#` on its own.
    { name: "EXTEND_TOP with no state", code: file("EXTEND_TOP ~dlg~\n  IF ~~ THEN EXIT\nEND") },
    { name: "EXTEND_TOP with a negative #position", code: file("EXTEND_TOP ~dlg~ 0 #-1\n  IF ~~ THEN EXIT\nEND") },
    { name: "a #position split by a space is rejected", code: file("EXTEND_TOP ~dlg~ 0 # 1\n  IF ~~ THEN EXIT\nEND") },
    {
        name: "a WEIGHT split by a space is rejected",
        code: file("BEGIN ~dlg~\nIF WEIGHT # 1 ~~ THEN BEGIN st\n  SAY ~hi~\nEND"),
    },

    // Strings and comments, at the lexer level.
    { name: "a five-tilde string holding tildes", code: asSayText("~~~~~he said ~hi~ ok~~~~~") },
    { name: "a block comment nested in another", code: file("/* a /* b */ c */\nBEGIN ~dlg~") },
    { name: "a nested block comment left open", code: file("/* a /* b */ c\nBEGIN ~dlg~") },
    { name: "a string whose whole content is //", code: asSayText("~//~") },
    { name: "a string whose whole content is /*", code: asSayText("~/*~") },
    { name: "a double-quoted string whose whole content is //", code: asSayText('"//"') },

    // CHAIN lines: each `=` line takes its own IF condition and DO action, `~m~ ~f~` is one line with a
    // female variant, and only `=` or `==` starts a new line.
    { name: "CHAIN line with a female variant", code: file("CHAIN ~a~ st\n~m~ ~f~\nEXIT") },
    { name: "CHAIN speaker line with a female variant", code: file("CHAIN ~a~ st\n~m~\n== ~b~ ~x~ ~y~\nEXIT") },
    { name: "CHAIN DO before =", code: file("CHAIN ~a~ st\n~m~ DO ~x~ = ~n~\nEXIT") },
    { name: "CHAIN IF and DO after =", code: file("CHAIN ~a~ st\n~m~ = IF ~c~ THEN ~n~ DO ~x~\nEXIT") },
    { name: "CHAIN speaker line with =", code: file("CHAIN ~a~ st\n~m~\n== ~b~ ~x~ = IF ~c~ ~y~\nEXIT") },
    {
        name: "CHAIN BRANCH inside a BRANCH",
        code: file("CHAIN ~a~ st\n~m~\nBRANCH ~t~ BEGIN\nBRANCH ~u~ BEGIN\n== ~b~ ~x~\nEND\nEND\nEXIT"),
    },
    { name: "CHAIN with an empty BRANCH", code: file("CHAIN ~a~ st\n~m~\nBRANCH ~t~ BEGIN END\nEXIT") },
    { name: "CHAIN with IF_FILE_EXISTS", code: file("CHAIN IF_FILE_EXISTS ~a~ st\n~m~\nEXIT") },
    { name: "CHAIN entry condition without THEN is rejected", code: file("CHAIN IF ~t~ ~a~ st\n~m~\nEXIT") },
    {
        name: "CHAIN lines not joined by = are rejected",
        code: file("CHAIN ~a~ st\n~m~ IF ~c~ THEN ~n~\nEXIT"),
    },
    {
        name: "CHAIN text after a BRANCH is rejected",
        code: file("CHAIN ~a~ st\n~m~\nBRANCH ~t~ BEGIN\n== ~b~ ~x~\nEND ~stray~\nEXIT"),
    },
    { name: "INTERJECT with IF_FILE_EXISTS", code: file("INTERJECT IF_FILE_EXISTS ~a~ st v\n== ~b~ ~x~\nEND ~c~ n") },
    { name: "INTERJECT with a BRANCH", code: file("INTERJECT ~a~ st v\nBRANCH ~t~ BEGIN\n== ~b~ ~x~\nEND\nEND ~c~ n") },
    { name: "INTERJECT with a tilde global variable", code: file("INTERJECT ~a~ st ~gv~\n== ~b~ ~x~\nEND ~c~ n") },
    { name: "INTERJECT with a %var% global variable", code: file("INTERJECT ~a~ st %gv%\n== ~b~ ~x~\nEND ~c~ n") },
    { name: "I_C_T with IF_FILE_EXISTS", code: file("I_C_T IF_FILE_EXISTS ~a~ st v\n== ~b~ ~x~\nEND") },
    { name: "I_C_T with SAFE and IF_FILE_EXISTS", code: file("I_C_T SAFE IF_FILE_EXISTS ~a~ st v\n== ~b~ ~x~\nEND") },
    {
        name: "INTERJECT_COPY_TRANS2 with IF_FILE_EXISTS",
        code: file("INTERJECT_COPY_TRANS2 IF_FILE_EXISTS ~a~ st v\n== ~b~ ~x~\nEND"),
    },
    { name: "I_C_T with a BRANCH", code: file("I_C_T ~a~ st v\nBRANCH ~t~ BEGIN\n== ~b~ ~x~\nEND\nEND") },

    // Aliases and the older in-state forms.
    { name: "alias A_S_T", code: file("A_S_T ~dlg~ 0 ~trig~") },
    { name: "alias A_T_T", code: file("A_T_T ~dlg~ 0 ~trig~") },
    { name: "alias R_A_T", code: file("R_A_T ~dlg~ ~old~ ~new~") },
    { name: "alias R_S_T", code: file("R_S_T ~dlg~ 0 ~trig~") },
    { name: "alias R_T_T", code: file("R_T_T ~dlg~ ~old~ ~new~") },
    { name: "alias EXTEND", code: file("EXTEND ~dlg~ 0\n  IF ~~ THEN EXIT\nEND") },
    {
        name: "APPENDI inside a state list",
        code: file(
            "APPEND ~d~\nIF ~~ THEN BEGIN s SAY ~x~ IF ~~ THEN EXIT END\n" +
                "APPENDI ~e~\nIF ~~ THEN BEGIN t SAY ~x~ IF ~~ THEN EXIT END\nEND\nEND",
        ),
    },
    { name: "CHAIN2 inside a state list", code: file("BEGIN ~d~\nCHAIN2 ~a~ s ~m~ = ~n~ == ~o~ END ~b~ t") },
    { name: "EXTEND_TOP_REGEXP is rejected", code: file("EXTEND_TOP_REGEXP ~dlg~ 0\n  IF ~~ THEN EXIT\nEND") },

    // Patch actions: guards, quoted keys, bare-word file names.
    {
        name: "ALTER_TRANS with a trailing IF guard",
        code: file("ALTER_TRANS ~d~ BEGIN 0 END BEGIN 0 END BEGIN TRIGGER ~x~ END IF ~c~"),
    },
    {
        name: "ALTER_TRANS with a quoted REPLY key",
        code: file("ALTER_TRANS ~d~ BEGIN 0 END BEGIN 0 END BEGIN ~REPLY~ ~x~ END"),
    },
    {
        name: "ALTER_TRANS with a bare REPLY key is rejected",
        code: file("ALTER_TRANS ~d~ BEGIN 0 END BEGIN 0 END BEGIN REPLY ~x~ END"),
    },
    {
        name: "ADD_TRANS_ACTION with an IF guard before the action is rejected",
        code: file("ADD_TRANS_ACTION ~dlg~ BEGIN 0 END BEGIN 0 END IF ~c~ ~act~"),
    },
    {
        name: "ADD_TRANS_ACTION with two trailing guards",
        code: file("ADD_TRANS_ACTION ~dlg~ BEGIN 0 END BEGIN 0 END ~act~ IF ~c~ UNLESS ~e~"),
    },
    { name: "BEGIN with a quoted non-pausing flag", code: file("BEGIN ~dlg~ ~1~") },
    {
        name: "REPLACE_TRIGGER_TEXT_REGEXP with a bare-word file",
        code: file("REPLACE_TRIGGER_TEXT_REGEXP FOO ~a~ ~b~"),
    },
    { name: "REPLACE_ACTION_TEXT_REGEXP with a bare-word file", code: file("REPLACE_ACTION_TEXT_REGEXP FOO ~a~ ~b~") },

    // A keyword is never a name, in any name slot.
    { name: "GOTO EXIT is rejected", code: inState("IF ~~ THEN GOTO EXIT") },
    { name: "GOTO DO is rejected", code: inState("IF ~~ THEN GOTO DO") },
    { name: "a state labelled SAY is rejected", code: asLabel("SAY") },
    { name: "a state labelled END is rejected", code: asLabel("END") },
    { name: "a dialog named IF is rejected", code: file("BEGIN IF") },
    { name: "a dialog named AT is rejected", code: file("SET_WEIGHT AT 0 #1") },
    { name: "an EXTERN dialog named REPLY is rejected", code: inState("IF ~~ THEN EXTERN REPLY 5") },
    // Every word the grammar reserves, as a state label: WeiDU rejects each, so the list holds no plain word.
    ...GRAMMAR_RESERVED_WORDS.map((word) => ({ name: `reserved word ${word} is not a label`, code: asLabel(word) })),
    // WeiDU's D lexer also keeps these two as keywords, though no rule uses them.
    ...["EXTEND_TOP_REGEXP", "EXTEND_BOTTOM_REGEXP"].map((word) => ({
        name: `unused keyword ${word} is accepted as a label although WeiDU rejects it`,
        code: asLabel(word),
        divergence:
            "tree-sitter reserves only words the grammar uses as tokens, and no D construct uses this one, so it " +
            "stays an ordinary name here.",
    })),

    // A bare word is the same string token as a quoted one wherever WeiDU takes a string: a trigger, an action,
    // a text, a patch action's old and new text. A keyword stays a keyword there too.
    { name: "bare-word state trigger", code: file("BEGIN ~d~\nIF foo THEN BEGIN s SAY ~x~ IF ~~ THEN EXIT END") },
    { name: "bare-word state trigger without THEN", code: file("BEGIN ~d~\nIF foo s SAY ~x~ IF ~~ THEN EXIT END") },
    { name: "a keyword as a state trigger is rejected", code: file("BEGIN ~d~\nIF SAY THEN BEGIN s SAY ~x~ END") },
    { name: "bare-word say text", code: asSayText("foo") },
    { name: "bare-word say text with a female variant", code: asSayText("foo bar") },
    { name: "bare-word say text joined by ^", code: asSayText("foo ^ bar") },
    { name: "bare-word say text with a sound", code: asSayText("foo [SND]") },
    { name: "a digit run as say text", code: asSayText("123") },
    { name: "a keyword as say text is rejected", code: asSayText("REPLY") },
    { name: "bare-word transition trigger", code: inState("IF foo THEN EXIT") },
    { name: "a keyword as a transition trigger is rejected", code: inState("IF GOTO THEN EXIT") },
    { name: "bare-word short transition trigger", code: inState("+ foo + ~r~ EXIT") },
    { name: "a short goto followed by a short transition", code: inState("IF ~~ THEN + foo\n  + bar + ~r~ EXIT") },
    { name: "bare-word DO action", code: inState("IF ~~ THEN DO foo EXIT") },
    { name: "bare-word CHAIN entry trigger", code: file("CHAIN IF foo THEN ~a~ st\n~m~\nEXIT") },
    { name: "bare-word CHAIN texts", code: file("CHAIN ~a~ st\nm\n== ~b~ n\nEXIT") },
    { name: "a keyword as CHAIN text is rejected", code: file("CHAIN ~a~ st\nGOTO\nEXIT") },
    { name: "bare-word CHAIN line condition", code: file("CHAIN ~a~ st\n~m~ = IF c THEN ~n~\nEXIT") },
    { name: "bare-word BRANCH trigger", code: file("CHAIN ~a~ st\n~m~\nBRANCH t BEGIN\n== ~b~ ~x~\nEND\nEXIT") },
    { name: "bare-word IF guard on a patch action", code: file("ADD_STATE_TRIGGER ~d~ 0 ~t~ IF c") },
    { name: "bare-word REPLACE_TRIGGER_TEXT texts", code: file("REPLACE_TRIGGER_TEXT ~d~ old new") },
    { name: "bare-word REPLACE_TRIGGER_TEXT_REGEXP texts", code: file("REPLACE_TRIGGER_TEXT_REGEXP ~d~ old new") },
    { name: "bare-word R_A_T texts", code: file("R_A_T ~d~ old new") },
    {
        name: "bare-word REPLACE_TRANS_ACTION texts",
        code: file("REPLACE_TRANS_ACTION ~d~ BEGIN 0 END BEGIN 0 END a b"),
    },
    { name: "bare-word A_S_T trigger", code: file("A_S_T ~d~ 0 trig") },
    { name: "a keyword as an A_S_T trigger is rejected", code: file("A_S_T ~d~ 0 EXIT") },
    { name: "bare-word ADD_TRANS_ACTION action", code: file("ADD_TRANS_ACTION ~d~ BEGIN 0 END BEGIN 0 END act") },
    { name: "bare-word ALTER_TRANS value", code: file("ALTER_TRANS ~d~ BEGIN 0 END BEGIN 0 END BEGIN TRIGGER x END") },

    // A %var% is a string wherever a string is, so it may stand for a whole trigger or action string (a value);
    // only a %var% standing for structure, such as a whole transition, is rejected.
    { name: "%var% state trigger", code: file("BEGIN ~d~\nIF %t% THEN BEGIN s SAY ~x~ IF ~~ THEN EXIT END") },
    { name: "%var% transition trigger", code: inState("IF %t% THEN EXIT") },
    { name: "%var% short transition trigger", code: inState("+ %t% + ~r~ EXIT") },
    { name: "%var% DO action", code: inState("IF ~~ THEN DO %a% EXIT") },
    { name: "%var% CHAIN entry trigger", code: file("CHAIN IF %t% THEN ~a~ st\n~m~\nEXIT") },
    { name: "%var% CHAIN line condition and action", code: file("CHAIN ~a~ st\n~m~ = IF %c% THEN ~n~ DO %a%\nEXIT") },
    { name: "%var% BRANCH trigger", code: file("CHAIN ~a~ st\n~m~\nBRANCH %t% BEGIN\n== ~b~ ~x~\nEND\nEXIT") },
    { name: "%var% A_S_T trigger and guard", code: file("ADD_STATE_TRIGGER ~d~ 0 %t% IF %c%") },
    { name: "%var% REPLACE_TRIGGER_TEXT texts", code: file("REPLACE_TRIGGER_TEXT ~d~ %o% %n%") },
    { name: "%var% ADD_TRANS_ACTION action", code: file("ADD_TRANS_ACTION ~d~ BEGIN 0 END BEGIN 0 END %a%") },
    { name: "%var% ALTER_TRANS value", code: file("ALTER_TRANS ~d~ BEGIN 0 END BEGIN 0 END BEGIN TRIGGER %x% END") },

    // An integer slot (FLAGS, the non-pausing flag, a transition-number list) takes any string WeiDU can convert
    // to an integer: bare, in hex, octal or binary, with `_` separators, or quoted with a sign. Anything else is
    // an error there.
    { name: "FLAGS in hex", code: inState("IF ~~ THEN FLAGS 0x4 EXIT") },
    { name: "FLAGS in octal and binary", code: inState("IF ~~ THEN FLAGS 0o7 EXIT\n  IF ~~ THEN FLAGS 0b11 EXIT") },
    { name: "FLAGS with a digit separator", code: inState("IF ~~ THEN FLAGS 1_0 EXIT") },
    { name: "FLAGS quoted", code: inState('IF ~~ THEN FLAGS ~4~ EXIT\n  IF ~~ THEN FLAGS "4" EXIT') },
    { name: "FLAGS quoted with a sign", code: inState('IF ~~ THEN FLAGS ~-4~ EXIT\n  IF ~~ THEN FLAGS "+4" EXIT') },
    { name: "FLAGS quoted in hex", code: inState("IF ~~ THEN FLAGS ~0x4~ EXIT") },
    { name: "FLAGS in a five-tilde string", code: inState("IF ~~ THEN FLAGS ~~~~~4~~~~~ EXIT") },
    { name: "FLAGS as a %var% holding a number", code: inState("IF ~~ THEN FLAGS %4% EXIT") },
    { name: "FLAGS with a bare word is rejected", code: inState("IF ~~ THEN FLAGS abc EXIT") },
    { name: "FLAGS with a quoted word is rejected", code: inState("IF ~~ THEN FLAGS ~abc~ EXIT") },
    { name: "FLAGS with digits then letters is rejected", code: inState("IF ~~ THEN FLAGS 4x EXIT") },
    { name: "FLAGS with a space inside the quotes is rejected", code: inState("IF ~~ THEN FLAGS ~ 4~ EXIT") },
    { name: "FLAGS with an empty string is rejected", code: inState("IF ~~ THEN FLAGS ~~ EXIT") },
    {
        name: "FLAGS as a %var% holding a word is accepted although WeiDU rejects it",
        code: inState("IF ~~ THEN FLAGS %abc% EXIT"),
        divergence:
            "A %var% substitutes a value once the file is installed, so a variable stands wherever its value may; " +
            "a standalone parse converts the name itself to an integer and fails.",
    },
    { name: "BEGIN with a hex non-pausing flag", code: file("BEGIN ~dlg~ 0x1") },
    { name: "BEGIN with a quoted negative non-pausing flag", code: file("BEGIN ~dlg~ ~-1~") },
    { name: "BEGIN with a quoted word as the flag is rejected", code: file("BEGIN ~dlg~ ~abc~") },
    { name: "a quoted transition number", code: file('ADD_TRANS_ACTION ~d~ BEGIN 0 END BEGIN ~0~ "1" END ~a~') },
    { name: "a hex transition number", code: file("ADD_TRANS_ACTION ~d~ BEGIN 0 END BEGIN 0x1 END ~a~") },
    {
        name: "a word as a transition number is rejected",
        code: file("ADD_TRANS_ACTION ~d~ BEGIN 0 END BEGIN a END ~a~"),
    },
    {
        name: "a quoted word as a transition number is rejected",
        code: file("ADD_TRANS_ACTION ~d~ BEGIN 0 END BEGIN ~abc~ END ~a~"),
    },

    // ADD_TRANS_TRIGGER's DO list names transitions, possibly none (then every transition gets the trigger).
    { name: "ADD_TRANS_TRIGGER with an empty DO list", code: file("ADD_TRANS_TRIGGER ~dlg~ 0 ~trig~ DO") },
    { name: "ADD_TRANS_TRIGGER with an empty DO list and a guard", code: file("A_T_T ~dlg~ 0 ~trig~ DO IF ~c~") },
    { name: "ADD_TRANS_TRIGGER with quoted and hex DO numbers", code: file("A_T_T ~dlg~ 0 ~trig~ DO ~1~ 0x2") },
    {
        name: "ADD_TRANS_TRIGGER with a word in the DO list is rejected although WeiDU accepts it",
        code: file("ADD_TRANS_TRIGGER ~dlg~ 0 ~trig~ DO abc"),
        divergence:
            "WeiDU parses the DO list as plain strings and converts each to a transition number only when the " +
            "action is applied, where a word fails the install; the grammar reports it where it is written.",
    },

    // State labels.
    { name: "numeric state label", code: asLabel("100") },
    { name: "alphanumeric state label", code: asLabel("4a") },
    { name: "dotted state label", code: asLabel("KHPC1.1") },
    { name: "hyphenated state label", code: asLabel("Quayle_Shar-Teel_1") },
    { name: "state label with a # namespace", code: asLabel("RR#ZA00") },

    // Deliberate boundaries. Both of these are settled decisions, so the case pins the current answer.
    {
        // The real-mod shape, not a minimal one: where the say text is itself a string WeiDU absorbs the
        // macro into it rather than erroring, so a `SAY ~hi~` fixture would test that absorption instead
        // of the construct. Real mods write `SAY @22`, where no absorption is possible.
        name: "a bare %macro% standing in for a whole transition is rejected",
        code: file("APPEND ~dlg~\n  IF ~~ st\n    SAY @22\n    %cespenar_weapon%\n    ++ @10 + other\n  END\nEND"),
    },
    {
        name: "an interpolated name is accepted although WeiDU rejects it",
        code: file("ADD_TRANS_ACTION %tutu_var%SAREVO BEGIN 0 END BEGIN 0 END ~act~"),
        divergence:
            "WeiDU lexes each %...% run as its own string token, so it reads %tutu_var%SAREVO as two " +
            "arguments and never reaches the BEGIN it wants next. The pieces only become one name once " +
            "the variable is resolved, which a standalone parse cannot do, so we accept it to stay quiet " +
            "on source that installs fine.",
    },
];

let weidu = "";
let tmpDir = "";

interface WeiduVerdict {
    accepts: boolean;
    /** Set when WeiDU gave no usable verdict, so the case is reported rather than silently passed. */
    inconclusive?: string;
}

function weiduVerdict(code: string, slug: string): WeiduVerdict {
    const target = path.join(tmpDir, `${slug}.d`);
    writeFileSync(target, code);
    try {
        execFileSync(weidu, ["--nogame", "--noautoupdate", "--parse-check", "d", target], {
            cwd: tmpDir,
            timeout: WEIDU_TIMEOUT_MS,
            stdio: "ignore",
        });
        return { accepts: true };
    } catch (error) {
        const status = exitStatus(error);
        if (status === WEIDU_PARSE_ERROR) return { accepts: false };
        if (status === WEIDU_OK) return { accepts: true };
        return { accepts: false, inconclusive: `weidu exited with status ${String(status)}` };
    }
}

/** Our grammar's verdict: any ERROR or MISSING node in the tree means we reject the snippet. */
function grammarAccepts(code: string): boolean {
    const tree = parseWithCache(code);
    expect(tree, "parser returned no tree").not.toBeNull();
    return !tree!.rootNode.hasError;
}

beforeAll(async () => {
    weidu = resolveWeidu();
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "weidu-d-differential-"));
    await initParser();
}, WEIDU_HOOK_TIMEOUT_MS);

afterAll(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe("WeiDU D differential (grammar vs the real binary)", () => {
    it("has a WeiDU binary and a case for every construct under test", () => {
        expect(weidu).not.toBe("");
        expect(CASES.length).toBeGreaterThan(0);
        // The reserved-word cases are generated from the grammar, so an empty set would drop them silently.
        expect(GRAMMAR_RESERVED_WORDS.length).toBeGreaterThan(0);
        // Case names are the failure labels, so a duplicate would silently hide one of the two.
        expect(new Set(CASES.map((c) => c.name)).size).toBe(CASES.length);
    });

    it.each(CASES)("$name: our grammar agrees with WeiDU", ({ name, code, divergence }) => {
        const slug = name.replaceAll(/[^a-z0-9]+/gi, "_");
        const verdict = weiduVerdict(code, slug);
        // An inconclusive WeiDU run is reported, never folded into "reject" - a silent exclusion would
        // let the gate shrink without the summary changing.
        expect(verdict.inconclusive, `WeiDU gave no verdict for "${name}"`).toBeUndefined();

        // A recorded divergence expects the OPPOSITE verdict; every other case expects agreement.
        // Both land on one unconditional assertion so no path can reach the end unchecked.
        const expected = divergence === undefined ? verdict.accepts : !verdict.accepts;
        const disagree = verdict.accepts
            ? "WeiDU accepts this but our grammar reports a syntax error"
            : "WeiDU rejects this but our grammar accepts it";
        const message =
            divergence === undefined
                ? disagree
                : `This case is recorded as a deliberate divergence, but the two now agree. ${divergence}`;

        expect(grammarAccepts(code), message).toBe(expected);
    });
});
