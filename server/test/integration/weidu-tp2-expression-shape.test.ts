/**
 * Differential on tree SHAPE: the accept/reject differential (weidu-tp2-grammar-differential.test.ts) cannot see an
 * expression that both sides accept but group differently, such as `1 + 2 * 3` read as `(1 + 2) * 3`. WeiDU's
 * `--debug-value` prints its own fully parenthesised reading of every value it evaluates, so each case here is
 * evaluated by a real (game-less) install and its grouping is compared with the one our tree gives.
 *
 * The comparison is on a skeleton - parentheses and operators only - because WeiDU prints operands in its own
 * notation (strings unquoted, predicates as one group). Cases are valid WeiDU and safe to evaluate: one runtime error
 * stops the install, and with it every later case.
 */

import { execFile } from "child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import type { Node } from "web-tree-sitter";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveWeidu, WEIDU_HOOK_TIMEOUT_MS, WEIDU_TIMEOUT_MS } from "../../../scripts/utils/src/weidu-binary.ts";
import { initParser, parseWithCache } from "@bgforge/shared/parsers/weidu-tp2";
import { SyntaxType } from "../../src/weidu-tp2/syntax-type";

/** Expressions WeiDU accepts, each chosen to separate two precedence levels or to end a one-string operand. */
const CASES = [
    // Arithmetic and its associativity.
    "1 + 2 * 3",
    "2 * 3 + 1",
    "10 - 3 - 2",
    "2 ** 3 ** 2",
    "2 * 2 ** 3",
    "7 REM 4 * 2",
    "1 MODULO 2 + 3",
    // Shifts sit between arithmetic and comparison.
    "1 BLSL 2 + 1",
    "1 << 2 + 1",
    "1 BLSL 2 < 5",
    // Relational binds tighter than equality.
    "1 + 2 < 4",
    "1 < 2 = 1",
    "1 != 2 + 1",
    // Bitwise operators sit below equality, each on its own level.
    "6 BAND 4 > 0",
    "4 = 4 BAND 6",
    "1 BOR 2 BAND 0",
    "1 BOR 2 BXOR 3",
    "1 BXOR 3 BAND 1",
    "1 & 3 | 4",
    "1 BOR 0 AND 0",
    // Boolean operators.
    "1 OR 0 AND 0",
    "1 AND 0 OR 1",
    "1 || 0 && 0",
    // Prefix operators bind tighter than every binary one; memory reads tighter still.
    "NOT 0 + 1",
    "BNOT 0 + 1",
    "ABS 0 - 5",
    "BYTE_AT 0 + 1",
    "SHORT_AT 0 = 12592",
    "NOT BYTE_AT 0",
    // The conditional is the loosest operator and groups to the right.
    "1 ? 2 : 3 + 4",
    "0 ? 1 : 0 ? 2 : 3",
    "1 + 2 ? 3 : 4",
    // A one-string operand ends at the string: what follows belongs to the enclosing expression.
    "FILE_EXISTS ~a~ AND FILE_EXISTS ~b~",
    "DIRECTORY_EXISTS ~a~ OR 0",
    "FILE_SIZE ~a~ 0 OR 0",
    "FILE_MD5 ~a~ ~b~ OR 0",
    "FILE_CONTAINS ~a~ ~b~ OR 0",
    "STRING_LENGTH ~abc~ > 2",
    "STRING_LENGTH ~abc~ + 1",
    "VARIABLE_IS_SET r OR 0",
    "IS_AN_INT r AND 1",
    "GAME_IS ~bg2~ OR 0",
    "ENGINE_IS ~bg2~ OR 0",
    "GAME_INCLUDES ~soa~ OR 0",
    "MOD_IS_INSTALLED ~x.tp2~ 0 AND 1",
    "MOD_IS_INSTALLED ~x.tp2~ (1 + 1) OR 0",
    "DEFINED_AS_FUNCTION f OR 0",
    "EVAL ~1~ + 1",
    "~a~ STRING_EQUAL ~b~ OR 1",
    "~a~ STRING_COMPARE_CASE ~b~ AND 1",
];

/** WeiDU's printed spelling of each operator our tree may carry under another spelling. */
const WEIDU_SPELLING: Record<string, string> = {
    "&&": "AND",
    "||": "OR",
    "&": "BAND",
    "|": "BOR",
    "^^": "BXOR",
    "<<": "BLSL",
    ">>": "BLSR",
    "`": "BNOT",
    "!": "NOT",
    "==": "=",
    EQUALS: "=",
    REM: "MODULO",
    STR_CMP: "STRING_COMPARE",
    STR_EQ: "STRING_EQUAL_CASE",
    STRING_COMPARE_REGEXP: "STRING_MATCHES_REGEXP",
};

/** String comparisons: WeiDU prints their operands bare, so the skeleton keeps only the operator. */
const STRING_OPS = new Set([
    "STRING_COMPARE",
    "STRING_COMPARE_CASE",
    "STRING_EQUAL",
    "STRING_EQUAL_CASE",
    "STRING_MATCHES_REGEXP",
    "STRING_CONTAINS_REGEXP",
]);

const BINARY_OPS = new Set([
    ...STRING_OPS,
    "+",
    "-",
    "*",
    "/",
    "**",
    "MODULO",
    "=",
    "<",
    ">",
    "<=",
    ">=",
    "AND",
    "OR",
    "BAND",
    "BOR",
    "BXOR",
    "BLSL",
    "BLSR",
    "BASR",
    "?",
    ":",
]);

const PREFIX_OPS = new Set([
    "NOT",
    "BNOT",
    "ABS",
    "BYTE_AT",
    "SBYTE_AT",
    "SHORT_AT",
    "SSHORT_AT",
    "LONG_AT",
    "SLONG_AT",
]);

const MEMORY_READS = new Set<string>([SyntaxType.ByteAtExpr, SyntaxType.ShortAtExpr, SyntaxType.LongAtExpr]);

type Group = (string | Group)[];

/** Parses WeiDU's printed value into nested groups, one per parenthesis pair. */
function parseGroups(text: string): Group {
    const root: Group = [];
    const stack: Group[] = [root];
    for (const token of text.match(/\(|\)|[^\s()]+/g) ?? []) {
        if (token === "(") {
            const group: Group = [];
            stack.at(-1)!.push(group);
            stack.push(group);
        } else if (token === ")") {
            stack.pop();
        } else {
            stack.at(-1)!.push(token);
        }
    }
    return root;
}

/** A group's skeleton: an operator group keeps its operators and sub-skeletons, anything else is one operand. */
function groupSkeleton(group: Group): string {
    const first = group[0];
    const operators = group.filter((item) => typeof item === "string" && BINARY_OPS.has(item));
    if (typeof first === "string" && PREFIX_OPS.has(first) && operators.length === 0) {
        return `(${first}${group
            .slice(1)
            .map((item) => (typeof item === "string" ? "" : groupSkeleton(item)))
            .join("")})`;
    }
    if (operators.length === 0) return "()";
    const parts = group.map((item) =>
        typeof item === "string" ? (BINARY_OPS.has(item) ? item : "") : groupSkeleton(item),
    );
    return `(${parts.join("")})`;
}

function weiduSkeleton(printed: string): string {
    const [outer] = parseGroups(printed);
    expect(typeof outer, `WeiDU printed no parenthesised value: ${printed}`).toBe("object");
    return groupSkeleton(outer as Group);
}

const spelled = (text: string): string => WEIDU_SPELLING[text] ?? text;

/** The same skeleton, read off our tree. */
function treeSkeleton(node: Node): string {
    switch (node.type) {
        case SyntaxType.Value:
        case SyntaxType.ParenExpr:
            return treeSkeleton(node.namedChildren[0]!);
        case SyntaxType.BinaryExpr: {
            const op = spelled(node.childForFieldName("op")!.text);
            if (STRING_OPS.has(op)) return `(${op})`;
            const left = treeSkeleton(node.childForFieldName("left")!);
            const right = treeSkeleton(node.childForFieldName("right")!);
            // WeiDU has no inequality node: it prints `a != b` as `NOT (a = b)`.
            if (op === "!=") return `(NOT(${left}=${right}))`;
            return `(${left}${op}${right})`;
        }
        case SyntaxType.UnaryExpr:
            return `(${spelled(node.childForFieldName("op")!.text)}${treeSkeleton(node.childForFieldName("operand")!)})`;
        case SyntaxType.TernaryExpr:
            return `(${treeSkeleton(node.childForFieldName("condition")!)}?${treeSkeleton(
                node.childForFieldName("then")!,
            )}:${treeSkeleton(node.childForFieldName("else")!)})`;
        default:
            if (MEMORY_READS.has(node.type)) {
                return `(${node.child(0)!.text}${treeSkeleton(node.childForFieldName("offset")!)})`;
            }
            // A literal, a variable or a predicate: one operand, as WeiDU prints it.
            return "()";
    }
}

/** The cases run inside one OUTER_PATCH, so memory reads have a buffer: `0123456789abcdef` starts 0x30 0x31. */
const BUFFER = "0123456789abcdef";
const SOURCE = `BACKUP ~x/backup~\nAUTHOR ~me~\n\nBEGIN ~c~\nOUTER_PATCH ~${BUFFER}~ BEGIN\n${CASES.map(
    (expr) => `  SET r = ${expr}\n`,
).join("")}END\n`;

let tmpDir = "";
let printed: string[] = [];
let installLog = "";

const execFileAsync = promisify(execFile);

beforeAll(async () => {
    const weidu = resolveWeidu();
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "weidu-tp2-shape-"));
    mkdirSync(path.join(tmpDir, "x", "backup"), { recursive: true });
    writeFileSync(path.join(tmpDir, "x", "setup-x.tp2"), SOURCE);
    // FILE_CONTAINS reads its file, and a missing one is a runtime error.
    writeFileSync(path.join(tmpDir, "a"), "a");
    try {
        const { stdout } = await execFileAsync(
            weidu,
            ["--nogame", "--noautoupdate", "--yes", "--debug-value", "x/setup-x.tp2"],
            { cwd: tmpDir, timeout: WEIDU_TIMEOUT_MS },
        );
        installLog = stdout;
    } catch (error) {
        // A failed install still printed the values it evaluated before the failure; the count check reports it.
        installLog = String((error as { stdout?: unknown }).stdout ?? error);
    }
    printed = [...installLog.matchAll(/^Value \[(.*)\] = /gm)].map((match) => match[1]!);
    await initParser();
}, WEIDU_HOOK_TIMEOUT_MS);

afterAll(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

/** Our tree's value node for each `SET r = ...`, in source order. */
function ourValues(): Node[] {
    const tree = parseWithCache(SOURCE);
    expect(tree, "parser returned no tree").not.toBeNull();
    expect(tree!.rootNode.hasError, "our grammar rejects the case file").toBe(false);
    return tree!.rootNode
        .descendantsOfType(SyntaxType.PatchSet)
        .map((set) => set!.childForFieldName("value"))
        .filter((value): value is Node => value !== null);
}

describe("WeiDU TP2 expression shape (grammar vs the real binary)", () => {
    it("WeiDU evaluated every case and our grammar parsed every case", () => {
        // Fewer printed values than cases means the install stopped early: the next case is the one that failed.
        expect(printed.length, `WeiDU stopped at case ${printed.length}:\n${installLog}`).toBe(CASES.length);
        expect(ourValues().length).toBe(CASES.length);
    });

    it.each(CASES.map((expr, index) => ({ expr, index })))("$expr groups as WeiDU groups it", ({ index }) => {
        const weidu = printed[index];
        expect(weidu, "WeiDU printed no value for this case").toBeDefined();
        expect(treeSkeleton(ourValues()[index]!), `WeiDU reads it as ${weidu}`).toBe(weiduSkeleton(weidu!));
    });
});
