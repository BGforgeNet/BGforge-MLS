/**
 * Differential: the WeiDU binary is the authority on what TP2 syntax is legal, so every construct the
 * grammar claims to support is checked against `weidu --parse-check` rather than against our own reading
 * of the docs. A divergence in either direction is a defect:
 *   - WeiDU accepts, we reject  -> a false "Syntax error" on valid syntax
 *   - we accept, WeiDU rejects  -> a real error the user never sees flagged
 *
 * This catches the class the external corpus cannot: a construct no mod in the corpus happens to use is
 * invisible to a corpus sweep, but is still syntax a user can write. FORCED_SUBCOMPONENT's predicate,
 * MENU_STYLE and LOAD were all found this way, with zero corpus occurrences between them.
 *
 * Sibling: weidu-d-grammar-differential.test.ts, which does the same for D; both find their binary
 * through weidu-binary.ts, which has no skip path.
 */

import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import {
    exitStatus,
    resolveWeidu,
    WEIDU_HOOK_TIMEOUT_MS,
    WEIDU_TIMEOUT_MS,
} from "../../../scripts/utils/src/weidu-binary.ts";
import { initParser, parseWithCache } from "@bgforge/shared/parsers/weidu-tp2";

/**
 * WeiDU exits 0 when the file parsed and 4 on a parse error. Anything else (crash, missing binary,
 * a WeiDU-side timeout) is not a verdict about the snippet, so it is reported rather than counted.
 */
const WEIDU_OK = 0;
const WEIDU_PARSE_ERROR = 4;

/** WeiDU rejects a TP2 whose BACKUP is not followed by AUTHOR, so every TP2-context snippet needs both. */
const TP2_PREAMBLE = "BACKUP ~x~\nAUTHOR ~me~\n\n";

/** A snippet in TP2 file context (prologue + whatever the case adds). */
const tp2 = (body: string) => TP2_PREAMBLE + body;

/** A snippet in component context - a component flag or an action inside BEGIN. */
const component = (body: string) => tp2(`BEGIN ~Core~\n${body}\n`);

/**
 * A snippet in patch context - inside a COPY block, after one known patch. Straight after the file pairs, a patch
 * keyword the grammar lacks would read as one more `source dest` pair and agree with WeiDU for the wrong reason.
 */
const patch = (body: string) => component(`COPY ~a~ ~b~\n  SET patch_context = 0\n  ${body}`);

/** A snippet in a macro body, where LOCAL_SET and LOCAL_SPRINT are legal. */
const macroBody = (body: string) => `DEFINE_ACTION_MACRO m BEGIN\n  ${body}\nEND\n`;

interface Case {
    name: string;
    code: string;
}

/**
 * One case per construct this grammar claims. Kept in WeiDU-context helpers rather than raw strings so a
 * case cannot accidentally test the preamble instead of its construct.
 */
const CASES: Case[] = [
    // Controls. Without these a template mistake (WeiDU requires AUTHOR after BACKUP) reads as every
    // construct being broken, so the pair is part of the suite rather than a one-off check.
    { name: "control: valid file parses", code: component("DESIGNATED 1") },
    { name: "control: bogus tokens are rejected", code: component("THIS_IS_NOT_A_KEYWORD ~a~ ~b~ !!!") },

    // Component flags, including the optional predicate WeiDU allows on the subcomponent/group family.
    { name: "SUBCOMPONENT with predicate", code: component("SUBCOMPONENT ~g~ ~pred~") },
    { name: "GROUP with predicate", code: component("GROUP ~g~ ~pred~") },
    { name: "FORCED_SUBCOMPONENT with predicate", code: component("FORCED_SUBCOMPONENT ~g~ ~pred~") },
    { name: "FORCED_SUBCOMPONENT without predicate", code: component("FORCED_SUBCOMPONENT ~g~") },
    { name: "METADATA", code: component("METADATA ~key value~") },
    { name: "NO_LOG_RECORD", code: component("NO_LOG_RECORD") },
    { name: "INSTALL_BY_DEFAULT", code: component("INSTALL_BY_DEFAULT") },
    { name: "DESIGNATED rejects a negative number", code: component("DESIGNATED -1") },

    // Top-level directives.
    { name: "ASK_EVERY_COMPONENT", code: tp2("ASK_EVERY_COMPONENT\n\nBEGIN ~Core~\nDESIGNATED 1\n") },
    { name: "SCRIPT_STYLE", code: tp2("SCRIPT_STYLE BG2\n\nBEGIN ~Core~\nDESIGNATED 1\n") },
    { name: "UNINSTALL_ORDER", code: tp2("UNINSTALL_ORDER ~MOVE~ ~COPY~\n\nBEGIN ~Core~\nDESIGNATED 1\n") },
    { name: "MODDER", code: tp2("MODDER ~SETUP_DEBUG~ ~ON~\n\nBEGIN ~Core~\nDESIGNATED 1\n") },
    { name: "MENU_STYLE", code: tp2("MENU_STYLE ~x~\n\nBEGIN ~Core~\nDESIGNATED 1\n") },
    { name: "LOAD", code: tp2("LOAD ~x.tp2~\n\nBEGIN ~Core~\nDESIGNATED 1\n") },
    // Arity matters and differs between the two: LOAD takes a list, MENU_STYLE exactly one argument.
    { name: "LOAD with several files", code: tp2("LOAD ~a.tp2~ ~b.tp2~\n\nBEGIN ~Core~\nDESIGNATED 1\n") },
    { name: "MENU_STYLE rejects a second argument", code: tp2("MENU_STYLE ~a~ ~b~\n\nBEGIN ~Core~\nDESIGNATED 1\n") },
    { name: "MENU_STYLE with a bare identifier", code: tp2("MENU_STYLE ansi\n\nBEGIN ~Core~\nDESIGNATED 1\n") },
    {
        name: "README followed by another directive",
        code: tp2("README ~r.txt~\nASK_EVERY_COMPONENT\n\nBEGIN ~Core~\nDESIGNATED 1\n"),
    },
    {
        name: "QUICK_MENU",
        code: tp2("QUICK_MENU\nALWAYS_ASK\n0\nEND\n~Everything~ BEGIN\n1\n2\nEND\nEND\n\nBEGIN ~Core~\nDESIGNATED 1\n"),
    },

    // Legacy keyword aliases. WeiDU resolves these in its lexer; the grammar accepts them so a mod using
    // an older spelling is not flagged, while only the canonical spelling is highlighted and completed.
    { name: "alias SUB_COMPONENT", code: component("SUB_COMPONENT ~g~") },
    { name: "alias I_S_I", code: patch("I_S_I 100") },
    {
        name: "alias PATCH_DEFINE_ASSOCIATIVE_ARRAY",
        code: patch("PATCH_DEFINE_ASSOCIATIVE_ARRAY arr BEGIN ~a~ => ~b~ END"),
    },
    {
        name: "alias DEFINE_MACRO_ACTION",
        code: tp2("DEFINE_MACRO_ACTION ~m~ BEGIN\nPRINT ~hi~\nEND\n\nBEGIN ~Core~\nDESIGNATED 1\n"),
    },
    { name: "alias ACTION_INCLUDE (TPA context)", code: "ACTION_INCLUDE ~inc.tpa~\n" },
    {
        name: "alias DEFINE_FUNCTION_ACTION (TPA context)",
        code: "DEFINE_FUNCTION_ACTION ~f~ BEGIN\n  PRINT ~hi~\nEND\n",
    },
    {
        name: "alias LAUNCH_FUNCTION_ACTION (TPA context)",
        code: "DEFINE_ACTION_FUNCTION ~f~ BEGIN\n  PRINT ~hi~\nEND\nLAUNCH_FUNCTION_ACTION ~f~ END\n",
    },

    // Actions and patches added alongside the alias work.
    { name: "EVAL as a standalone patch", code: patch("EVAL") },
    { name: "EVALUATE_BUFFER as a standalone patch", code: patch("EVALUATE_BUFFER") },
    { name: "APPEND_COL_OUTER", code: component("APPEND_COL_OUTER ~f.2da~ ~text~") },
    { name: "PATCH_BASH_FOR", code: patch("PATCH_BASH_FOR ~dir~ ~^.*\\.itm$~ BEGIN\n    PATCH_PRINT ~hi~\n  END") },
    { name: "GET_FILE_ARRAY", code: component("GET_FILE_ARRAY arr ~dir~ ~^.*$~") },
    { name: "GET_DIRECTORY_ARRAY", code: component("GET_DIRECTORY_ARRAY arr ~dir~ ~^.*$~") },
    {
        name: "RESOURCE_CONTAINS",
        code: patch("PATCH_IF RESOURCE_CONTAINS ~res~ ~re~ BEGIN\n    PATCH_PRINT ~hi~\n  END"),
    },
    { name: "COMPRESS_INTO_VAR", code: patch("COMPRESS_INTO_VAR 0 10 9 var") },
    { name: "COPY_LARGE with several file pairs", code: component("COPY_LARGE ~a~ ~b~\n           ~c~ ~d~") },
    { name: "ALTER_TLK_LIST", code: component("ALTER_TLK_LIST BEGIN ~x~ END BEGIN REPLACE_TEXTUALLY ~^~ ~BG1 ~ END") },
    { name: "ACTION_GET_STRREF", code: component("ACTION_GET_STRREF 1 var") },
    { name: "ACTION_GET_STRREF_FS", code: component("ACTION_GET_STRREF_FS 1 var") },
    {
        name: "ACTION_PHP_EACH with a quoted loop variable",
        code: component("ACTION_PHP_EACH arr AS data => ~~ BEGIN\nPRINT ~hi~\nEND"),
    },
    { name: "STRING_SET single pair", code: component("STRING_SET ~1~ ~a~") },

    // ABORT is an action as well as a patch (PATCH_ABORT).
    { name: "ABORT", code: component("ABORT ~msg~") },

    // The sort type is optional and defaults to LEXICOGRAPHICALLY; the action form shares it.
    { name: "SORT_ARRAY_INDICES without a sort type", code: patch("SORT_ARRAY_INDICES arr") },
    { name: "SORT_ARRAY_INDICES NUMERICALLY", code: patch("SORT_ARRAY_INDICES arr NUMERICALLY") },
    { name: "ACTION_SORT_ARRAY_INDICES without a sort type", code: component("ACTION_SORT_ARRAY_INDICES arr") },
    {
        name: "ACTION_SORT_ARRAY_INDICES LEXICOGRAPHICALLY",
        code: component("ACTION_SORT_ARRAY_INDICES arr LEXICOGRAPHICALLY"),
    },

    // Compound assignment: the shift and bitwise-xor forms exist; ||= and &&= do not.
    { name: "SET <<=", code: patch("SET x <<= 1") },
    { name: "SET >>=", code: patch("SET x >>= 1") },
    { name: "SET ^^=", code: patch("SET x ^^= 1") },
    { name: "bare patch assignment <<=", code: patch("x <<= 1") },
    { name: "OUTER_SET >>=", code: component("OUTER_SET x >>= 1") },
    { name: "SET rejects ||=", code: patch("SET x ||= 1") },
    { name: "SET rejects &&=", code: patch("SET x &&= 1") },
    { name: "SET ++ prefix", code: patch("SET ++x") },
    { name: "SET -- prefix", code: patch("SET --x") },
    { name: "SET GLOBAL ++", code: patch("SET GLOBAL ++x") },
    { name: "bare GLOBAL assignment", code: patch("GLOBAL x = 1") },
    { name: "bare GLOBAL ++", code: patch("GLOBAL ++x") },
    { name: "LOCAL_SET =", code: macroBody("LOCAL_SET x = 1") },
    { name: "LOCAL_SET rejects +=", code: macroBody("LOCAL_SET x += 1") },
    { name: "LOCAL_TEXT_SPRINT", code: macroBody("LOCAL_TEXT_SPRINT x ~a~") },

    // Actions the grammar did not model.
    { name: "ACTION_RERAISE", code: component("ACTION_RERAISE") },
    { name: "ACTION_TIME", code: component("ACTION_TIME ~t~ BEGIN PRINT ~x~ END") },
    { name: "ADD_SCHOOL", code: component("ADD_SCHOOL ~MYSCHOOL~ @1") },
    { name: "COPY_KIT with column/value pairs", code: component("COPY_KIT ~a~ ~b~ (~c~ ~d~ ~e~ ~f~)") },
    { name: "COPY_KIT with an empty list", code: component("COPY_KIT ~a~ ~b~ ()") },
    { name: "BIFF alias of MAKE_BIFF", code: component("BIFF ~a.bif~ BEGIN ~dir~ ~.*\\.itm~ END") },
    { name: "MAKE_BIFF with no file entries", code: component("MAKE_BIFF ~x~ BEGIN END") },
    { name: "ALTER_TLK", code: component("ALTER_TLK BEGIN REPLACE ~a~ ~b~ END") },
    { name: "ALTER_TLK_RANGE", code: component("ALTER_TLK_RANGE 1 5 BEGIN REPLACE ~a~ ~b~ END") },
    { name: "STRING_SET_RANGE", code: component("STRING_SET_RANGE #1 #2 USING ~f.tra~") },
    { name: "EXTEND_TOP_REGEXP", code: component("EXTEND_TOP_REGEXP ~a.bcs~ ~b.baf~ USING ~t.tra~") },
    { name: "EXTEND_BOTTOM_REGEXP with a patch", code: component("EXTEND_BOTTOM_REGEXP ~a~ ~b~ SET x = 1") },
    { name: "EXTEND_TOP patches before USING", code: component("EXTEND_TOP ~a~ ~b~ SET x = 1 USING ~t.tra~") },
    { name: "EXTEND_TOP with a when clause", code: component("EXTEND_TOP ~a~ ~b~ IF ~x~") },
    { name: "COPY with IF_EVAL", code: component("COPY ~a~ ~b~ SET x = 1 IF_EVAL 1") },
    { name: "ADD_SPELL with IF_EXISTING", code: component("ADD_SPELL ~a~ 1 2 ~b~ IF_EXISTING SET x = 1 END") },
    {
        name: "ADD_SPELL with IF_EXISTING and ON_DISABLE",
        code: component("ADD_SPELL ~a~ 1 2 ~b~ IF_EXISTING END ON_DISABLE END"),
    },
    { name: "ADD_SPELL with a when clause", code: component("ADD_SPELL ~a~ 1 2 ~b~ IF ~x~") },

    // Patches the grammar did not model.
    { name: "GET_STRREF_F", code: patch("GET_STRREF_F 5 x") },
    { name: "GET_STRREF_FS", code: patch("GET_STRREF_FS 5 x") },
    { name: "SET_IDS_SYMBOL_OF_INT", code: patch("SET_IDS_SYMBOL_OF_INT ~sym~ ~ids~ 5") },
    { name: "LOOKUP_IDS_SYMBOL_OF_INT into a quoted variable", code: patch("LOOKUP_IDS_SYMBOL_OF_INT ~x~ ~f~ 1") },
    { name: "WRITE_ASCII_TERMINATED", code: patch("WRITE_ASCII_TERMINATED 0 ~abc~") },
    { name: "PATCH_CLEAR_ARRAY", code: patch("PATCH_CLEAR_ARRAY ~arr~") },
    { name: "APPEND_FILE TEXT", code: patch("APPEND_FILE TEXT ~f~") },
    { name: "APPEND_FILE_EVALUATE TEXT", code: patch("APPEND_FILE_EVALUATE TEXT ~f~") },
    { name: "WRITE_FILE", code: patch("WRITE_FILE 0 ~f~") },
    { name: "INSERT_FILE", code: patch("INSERT_FILE 0 ~f~") },
    { name: "EXTEND_MOS", code: patch("EXTEND_MOS ~a.mos~ 5") },
    { name: "EDIT_SAV_FILE", code: patch("EDIT_SAV_FILE 0 ~a.cre~ BEGIN WRITE_BYTE 0 1 END") },
    {
        name: "EDIT_SAV_FILE ADD_IF_MISSING with several files",
        code: patch("EDIT_SAV_FILE 1 ADD_IF_MISSING ~a~ ~b~ BEGIN END"),
    },
    { name: "PATCH_GAM", code: patch("PATCH_GAM ~a~ ~b~ #1 #2") },
    { name: "ADD_GAME_NPC", code: patch("ADD_GAME_NPC ~a~ ~b~ #0 #0") },
    { name: "APPLY_BCS_PATCH", code: patch("APPLY_BCS_PATCH ~p.bcs~") },
    { name: "alias A_B_P", code: patch("A_B_P ~p.bcs~") },
    { name: "APPLY_BCS_PATCH_OR_COPY", code: patch("APPLY_BCS_PATCH_OR_COPY ~p.bcs~ ~q.bcs~") },
    { name: "REFACTOR_TRIGGER with flags", code: patch("REFACTOR_TRIGGER CASE_SENSITIVE EXACT_MATCH ~a~ ~b~") },
    { name: "REFACTOR_BAF_TRIGGER", code: patch("REFACTOR_BAF_TRIGGER ~a~ ~b~") },
    { name: "REBUILD_CRE_FILE", code: patch("REBUILD_CRE_FILE") },
    { name: "REPLACE_BCS_BLOCK_REGEXP", code: patch("REPLACE_BCS_BLOCK_REGEXP ~a~ ~b~ ON_MISMATCH END") },
    { name: "R_B_B_RE", code: patch("R_B_B_RE ~a~ ~b~") },
    { name: "REPLACE_BCS_BLOCK EVALUATE_BUFFER", code: patch("REPLACE_BCS_BLOCK EVALUATE_BUFFER ~a~ ~b~") },
    { name: "REPLACE_BCS_BLOCK rejects a third file", code: patch("REPLACE_BCS_BLOCK ~a~ ~b~ ~c~") },
    { name: "PATCH_REINCLUDE", code: patch("PATCH_REINCLUDE ~a.tph~ ~b.tph~") },
    { name: "PATCH_RANDOM_SEED", code: patch("PATCH_RANDOM_SEED (x + 1)") },
    { name: "PATCH_READLN", code: patch("PATCH_READLN x") },
    { name: "PATCH_WITH_TRA", code: patch("PATCH_WITH_TRA ~a~ ~b~ BEGIN SET x = 1 END") },

    // Value functions the grammar did not model.
    { name: "BIFF_IS_COMPRESSED", code: component("ACTION_IF BIFF_IS_COMPRESSED ~a.bif~ BEGIN END") },
    { name: "FILE_IS_IN_COMPRESSED_BIF", code: component("ACTION_IF FILE_IS_IN_COMPRESSED_BIF ~a~ BEGIN END") },
    { name: "SIZE_OF_FILE", code: component("OUTER_SET x = SIZE_OF_FILE ~a~") },
    { name: "VALID_SCRIPT_ACTIONS", code: component("ACTION_IF VALID_SCRIPT_ACTIONS ~a~ BEGIN END") },
    { name: "VALID_SCRIPT_TRIGGERS", code: component("ACTION_IF VALID_SCRIPT_TRIGGERS ~a~ BEGIN END") },
    { name: "INSTALL_ORDER AFTER", code: component("ACTION_IF INSTALL_ORDER ~a~ 1 AFTER ~b~ 2 BEGIN END") },
    { name: "INSTALL_ORDER BEFORE", code: component("ACTION_IF INSTALL_ORDER ~a~ 1 BEFORE ~b~ 2 BEGIN END") },

    // Lexer-level changes.
    { name: "subtraction written without spaces", code: patch("WRITE_LONG 0 (%SOURCE_SIZE%-12)") },
    { name: "a string whose whole content is //", code: patch("REPLACE_TEXTUALLY ~//~ ~x~") },
    {
        name: "digit-leading parameter name (TPA context)",
        code: "DEFINE_ACTION_FUNCTION ~f~ STR_VAR 2da = ~~ BEGIN\n  PRINT ~hi~\nEND\n",
    },
];

let weidu = "";
let tmpDir = "";

interface WeiduVerdict {
    /** The file type that accepted the snippet, or null when all three rejected it. */
    acceptedAs: string | null;
    /** Set when WeiDU gave no usable verdict, so the case is reported rather than silently passed. */
    inconclusive?: string;
}

/**
 * Our grammar's source_file is deliberately the union of TP2/TPA/TPP - one grammar serves .tp2, .tpa,
 * .tph and .tpp - while WeiDU parse-checks against a single declared type. So a snippet counts as valid
 * WeiDU if ANY of the three accepts it; comparing against TP2 alone reports TPA-context constructs
 * (function definitions, ACTION_INCLUDE) as though the grammar invented them.
 */
function weiduVerdict(code: string, slug: string): WeiduVerdict {
    const file = path.join(tmpDir, `${slug}.tp2`);
    writeFileSync(file, code);
    for (const type of ["TP2", "TPA", "TPP"]) {
        try {
            execFileSync(weidu, ["--nogame", "--noautoupdate", "--parse-check", type, file], {
                cwd: tmpDir,
                timeout: WEIDU_TIMEOUT_MS,
                stdio: "ignore",
            });
            return { acceptedAs: type };
        } catch (error) {
            const status = exitStatus(error);
            if (status !== WEIDU_OK && status !== WEIDU_PARSE_ERROR) {
                return { acceptedAs: null, inconclusive: `${type} exited with status ${String(status)}` };
            }
        }
    }
    return { acceptedAs: null };
}

/** Our grammar's verdict: any ERROR or MISSING node in the tree means we reject the snippet. */
function grammarAccepts(code: string): boolean {
    const tree = parseWithCache(code);
    expect(tree, "parser returned no tree").not.toBeNull();
    return !tree!.rootNode.hasError;
}

beforeAll(async () => {
    weidu = resolveWeidu();
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "weidu-tp2-differential-"));
    await initParser();
}, WEIDU_HOOK_TIMEOUT_MS);

afterAll(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe("WeiDU TP2 differential (grammar vs the real binary)", () => {
    it("has a WeiDU binary and a case for every construct under test", () => {
        expect(weidu).not.toBe("");
        expect(CASES.length).toBeGreaterThan(0);
        // Case names are the failure labels, so a duplicate would silently hide one of the two.
        expect(new Set(CASES.map((c) => c.name)).size).toBe(CASES.length);
    });

    it.each(CASES)("$name: our grammar agrees with WeiDU", ({ name, code }) => {
        const slug = name.replaceAll(/[^a-z0-9]+/gi, "_");
        const verdict = weiduVerdict(code, slug);
        // An inconclusive WeiDU run is reported, never folded into "reject" - a silent exclusion would
        // let the gate shrink without the summary changing.
        expect(verdict.inconclusive, `WeiDU gave no verdict for "${name}"`).toBeUndefined();

        const weiduAccepts = verdict.acceptedAs !== null;
        expect(
            grammarAccepts(code),
            weiduAccepts
                ? `WeiDU accepts this as ${verdict.acceptedAs} but our grammar reports a syntax error`
                : "WeiDU rejects this as TP2, TPA and TPP but our grammar accepts it",
        ).toBe(weiduAccepts);
    });
});
