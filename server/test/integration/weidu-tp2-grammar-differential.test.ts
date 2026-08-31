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
import { exitStatus, resolveWeidu, WEIDU_TIMEOUT_MS } from "./weidu-binary";
import { initParser, parseWithCache } from "../../../shared/parsers/weidu-tp2";

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

/** A snippet in patch context - inside a COPY block. */
const patch = (body: string) => component(`COPY ~a~ ~b~\n  ${body}`);

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
});

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
