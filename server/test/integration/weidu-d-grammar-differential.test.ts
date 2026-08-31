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
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { exitStatus, resolveWeidu, WEIDU_TIMEOUT_MS } from "./weidu-binary";
import { initParser, parseWithCache } from "../../../shared/parsers/weidu-d";

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
});

afterAll(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe("WeiDU D differential (grammar vs the real binary)", () => {
    it("has a WeiDU binary and a case for every construct under test", () => {
        expect(weidu).not.toBe("");
        expect(CASES.length).toBeGreaterThan(0);
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
