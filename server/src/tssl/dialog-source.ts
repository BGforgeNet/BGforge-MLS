/**
 * TSSL SOURCE parser: parses raw `.tssl` TypeScript directly (no transpile, no esbuild bundle) into the
 * SSL `DialogData` shape, with byte ranges pointing into the `.tssl` SOURCE. This is what makes `.tssl`
 * dialogs editable in place - unlike `parseTSSLDialog` (transpile-then-parse), whose ranges point into
 * throwaway generated SSL.
 *
 * SSL-in-TS convention: a top-level `function NodeNNN` is a dialog node; `Reply`/`*Option`/`*Message` are
 * dialog calls (identical vocabulary to SSL); a call to another local function is a `call` transition;
 * `talk_p_proc` is the entry router. Faithfulness tiers mirror the SSL parser (`server/src/dialog.ts`),
 * computed from TS statement structure rather than tree-sitter (the classification is delimiter-agnostic,
 * so `if (c) { ... }` classifies exactly as SSL's `if (c) then ...` - see the design spec).
 */

import { Node, Project, SyntaxKind, type CallExpression, type FunctionDeclaration } from "ts-morph";
import type {
    SSLDialogData,
    SSLDialogNode,
    SSLDialogOption,
    SSLDialogOptionType,
    SSLDialogReply,
} from "../../../shared/dialog-types";

const OPTION_FNS: ReadonlySet<string> = new Set<SSLDialogOptionType>([
    "NOption",
    "NLowOption",
    "GOption",
    "GLowOption",
    "BOption",
    "BLowOption",
]);
const MESSAGE_FNS: ReadonlySet<string> = new Set<SSLDialogOptionType>(["NMessage", "GMessage", "BMessage"]);
const isOptionFn = (n: string): n is SSLDialogOptionType => OPTION_FNS.has(n);
const isMessageFn = (n: string): n is SSLDialogOptionType => MESSAGE_FNS.has(n);

const TALK_PROC = "talk_p_proc";

const span = (n: Node): { start: number; end: number } => ({ start: n.getStart(), end: n.getEnd() });

/** The callee identifier of a call, or undefined for a non-identifier callee (member/computed call). */
function calleeName(call: CallExpression): string | undefined {
    const expr = call.getExpression();
    return expr.getKind() === SyntaxKind.Identifier ? expr.getText() : undefined;
}

/** The enclosing statement span (incl. the trailing `;`) of a dialog call, for delete/remove. */
function stmtSpan(call: CallExpression): { start: number; end: number } {
    const stmt = call.getFirstAncestorByKind(SyntaxKind.ExpressionStatement);
    return stmt ? span(stmt) : span(call);
}

/** Resolve a message-id argument: a numeric literal -> its number; anything else -> its text + a computed/random kind. */
function msgIdOf(arg: Node | undefined): { msgId: number | string; msgKind?: "computed" | "random" } {
    if (!arg) return { msgId: 0 };
    if (arg.getKind() === SyntaxKind.NumericLiteral) return { msgId: Number(arg.getText()) };
    if (Node.isCallExpression(arg)) {
        return { msgId: arg.getText(), msgKind: calleeName(arg) === "random" ? "random" : "computed" };
    }
    return { msgId: arg.getText(), msgKind: "computed" };
}

// ---------------------------------------------------------------------------
// Faithfulness tiers (mirror server/src/dialog.ts, over the TS AST).
// ---------------------------------------------------------------------------

/** A statement usable as dialog: a Reply/Option/Message call, or a call to another local node (a transition). */
function isDialogOrTransitionStmt(stmt: Node, localFns: ReadonlySet<string>): boolean {
    if (!Node.isExpressionStatement(stmt)) return false;
    const expr = stmt.getExpression();
    if (!Node.isCallExpression(expr)) return false;
    const name = calleeName(expr);
    if (name === undefined) return false;
    return name === "Reply" || isOptionFn(name) || isMessageFn(name) || localFns.has(name);
}

/** Faithful: a flat sequence of dialog statements plus single-level `if` (no else) wrapping faithful bodies. */
function isFaithfulStmt(stmt: Node, allowIf: boolean, localFns: ReadonlySet<string>): boolean {
    if (Node.isExpressionStatement(stmt)) return isDialogOrTransitionStmt(stmt, localFns);
    if (Node.isIfStatement(stmt)) {
        if (!allowIf) return false; // nested if -> not faithful
        if (stmt.getElseStatement()) return false; // else -> not faithful
        return isFaithfulBranch(stmt.getThenStatement(), localFns);
    }
    return false;
}

function isFaithfulBranch(branch: Node, localFns: ReadonlySet<string>): boolean {
    if (Node.isBlock(branch)) return branch.getStatements().every((s) => isFaithfulStmt(s, false, localFns));
    return isFaithfulStmt(branch, false, localFns);
}

/** Structured: any call plus arbitrarily nested `if`/`else` blocks - no loop/switch/return-branching. */
function isStructuredStmt(stmt: Node): boolean {
    if (Node.isExpressionStatement(stmt)) return Node.isCallExpression(stmt.getExpression());
    if (Node.isIfStatement(stmt)) {
        const elseStmt = stmt.getElseStatement();
        return isStructuredBranch(stmt.getThenStatement()) && (!elseStmt || isStructuredBranch(elseStmt));
    }
    return false; // for/while/switch/... -> not structured
}

function isStructuredBranch(branch: Node): boolean {
    if (Node.isBlock(branch)) return branch.getStatements().every((s) => isStructuredStmt(s));
    return isStructuredStmt(branch);
}

function classifyTier(
    fn: FunctionDeclaration,
    localFns: ReadonlySet<string>,
): "faithful" | "structured" | "approximate" {
    const stmts = fn.getStatements();
    if (stmts.every((s) => isFaithfulStmt(s, true, localFns))) return "faithful";
    if (stmts.every((s) => isStructuredStmt(s))) return "structured";
    return "approximate";
}

// ---------------------------------------------------------------------------
// Node builder
// ---------------------------------------------------------------------------

function buildNode(fn: FunctionDeclaration, name: string, localFns: ReadonlySet<string>): SSLDialogNode {
    const replies: SSLDialogReply[] = [];
    const options: SSLDialogOption[] = [];
    const callTargets: string[] = [];

    // Full-subtree walk so a nested dialog call is never dropped (the content-faithfulness invariant).
    fn.forEachDescendant((node) => {
        if (!Node.isCallExpression(node)) return;
        const cn = calleeName(node);
        if (cn === undefined) return;
        const args = node.getArguments();
        const line = node.getStartLineNumber();
        if (cn === "Reply" && args[0]) {
            replies.push({ ...msgIdOf(args[0]), line });
        } else if (isOptionFn(cn) && args[0] && args[1]) {
            options.push({
                type: cn,
                ...msgIdOf(args[0]),
                target: args[1].getText(),
                skill: args[2] ? Number(args[2].getText()) : undefined,
                line,
                callRange: span(node),
                targetRange: span(args[1]),
                stmtRange: stmtSpan(node),
            });
        } else if (isMessageFn(cn) && args[0]) {
            // A terminal message has no target node.
            options.push({ type: cn, ...msgIdOf(args[0]), target: "", line, stmtRange: stmtSpan(node) });
        } else if (localFns.has(cn)) {
            if (!callTargets.includes(cn)) callTargets.push(cn); // a call to another node is a transition
        }
        // else: a side-effect / engine builtin - not surfaced as dialog this phase.
    });

    const tier = classifyTier(fn, localFns);
    const nameNode = fn.getNameNode();
    return {
        name,
        line: fn.getStartLineNumber(),
        replies,
        options,
        callTargets,
        faithful: tier === "faithful",
        ...(tier === "structured" ? { structured: true as const } : {}),
        ...(tier === "approximate" ? { approximate: true as const } : {}),
        procRange: span(fn),
        ...(nameNode ? { nameRange: span(nameNode) } : {}),
    };
}

/**
 * Parse TSSL source into SSL DialogData with ranges into the source. Phase 1 (read-only view): produces
 * nodes (name, replies, options, callTargets, tier flags, procRange/nameRange) and entry points. The
 * write-back anchors (insertAnchor, entryCalls, branches/block) are added when TSSL editing lands (Phase 2+).
 */
export function parseTSSLSource(text: string): SSLDialogData {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile("dialog.tssl.ts", text);
    const fns = sf.getFunctions();
    const localFns = new Set<string>(fns.map((f) => f.getName()).filter((n): n is string => n !== undefined));

    const nodes: SSLDialogNode[] = [];
    const entryPoints: string[] = [];
    const procNames: string[] = [];
    for (const fn of fns) {
        const name = fn.getName();
        if (name === undefined) continue;
        if (name === TALK_PROC) {
            // Entry points: each `NodeNNN();` call in talk_p_proc (a call to a local node).
            fn.forEachDescendant((node) => {
                if (!Node.isCallExpression(node)) return;
                const cn = calleeName(node);
                if (cn !== undefined && localFns.has(cn) && !entryPoints.includes(cn)) entryPoints.push(cn);
            });
            continue;
        }
        procNames.push(name);
        nodes.push(buildNode(fn, name, localFns));
    }
    return { nodes, entryPoints, procNames };
}
