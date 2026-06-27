/**
 * Dialog parser for Fallout SSL scripts using tree-sitter.
 * Extracts dialog structure (nodes, replies, options) for visualization.
 */

import type { Node as SyntaxNode } from "web-tree-sitter";
import { initParser, parseWithCache, isInitialized } from "../../shared/parsers/fallout-ssl";
import { SyntaxType } from "./fallout-ssl/syntax-type";
import type {
    SSLDialogData,
    SSLDialogNode,
    SSLDialogOption,
    SSLDialogOptionType,
    SSLDialogReply,
} from "../../shared/dialog-types";

export type { SSLDialogData as DialogData };

// Membership sets for SSL option/message types. Using ReadonlySet<string>
// (rather than Set<SSLDialogOptionType>) lets the .has() check act as a
// type guard via `isOptionFn`/`isMessageFn` below - no `as` cast needed.
const OPTION_FN_NAMES: ReadonlySet<string> = new Set<SSLDialogOptionType>([
    "NOption",
    "NLowOption",
    "GOption",
    "GLowOption",
    "BOption",
    "BLowOption",
]);

const MESSAGE_FN_NAMES: ReadonlySet<string> = new Set<SSLDialogOptionType>(["NMessage", "GMessage", "BMessage"]);

function isOptionFn(name: string): name is SSLDialogOptionType {
    return OPTION_FN_NAMES.has(name);
}

function isMessageFn(name: string): name is SSLDialogOptionType {
    return MESSAGE_FN_NAMES.has(name);
}

// Default: no side-effect set supplied -> no detection (honest under-badging, preserving
// the parser's pre-side-effect behavior for callers that don't pass the set).
const NO_SIDE_EFFECTS: ReadonlySet<string> = new Set<string>();

/**
 * Parse dialog structure from SSL script text using tree-sitter.
 *
 * `sideEffectFns` is the set of state-mutating builtins (already filtered to exclude
 * display/debug void fns) used to flag nodes for the side-effect honesty badge; pass the
 * empty set (the default) to skip side-effect detection. The parser only records which of
 * these a node calls - it does not own the classification policy.
 */
export async function parseDialog(
    text: string,
    sideEffectFns: ReadonlySet<string> = NO_SIDE_EFFECTS,
): Promise<SSLDialogData> {
    if (!isInitialized()) {
        await initParser();
    }
    const tree = parseWithCache(text);
    if (!tree) {
        return { nodes: [], entryPoints: [] };
    }
    const root = tree.rootNode;

    const nodes: SSLDialogNode[] = [];
    const entryPoints: string[] = [];

    // First pass: parse every dialog procedure into a map; collect entry points
    // from talk_p_proc (the single dialog root).
    const parsed = new Map<string, SSLDialogNode>();
    for (const child of root.children) {
        if (child.type !== SyntaxType.Procedure) continue;
        const nameNode = child.childForFieldName("name");
        if (!nameNode) continue;
        const procName = nameNode.text;

        if (procName === "talk_p_proc") {
            extractEntryPoints(child, entryPoints);
            continue;
        }
        parsed.set(procName, parseProcedure(child, procName, sideEffectFns));
    }

    // force_dialog_start(Node*) / start_dialog_at_node(Node*) start a conversation
    // from outside talk_p_proc (timers, map-enter); treat their targets as entries.
    walkTree(root, (node) => {
        if (node.type !== SyntaxType.CallExpr) return;
        const fn = node.childForFieldName("func")?.text;
        if (fn !== "force_dialog_start" && fn !== "start_dialog_at_node") return;
        const arg = getCallArgs(node)[0];
        if (!arg) return;
        const name = arg.type === SyntaxType.CallExpr ? arg.childForFieldName("func")?.text : arg.text;
        if (name && !entryPoints.includes(name)) entryPoints.push(name);
    });

    // Second pass: include only procedures reachable from a dialog entry point
    // (talk_p_proc calls + force_dialog_start targets), following option and call
    // transitions. A procedure that merely contains dialog-shaped calls but sits outside the
    // conversation graph - an SSL lifecycle handler like pickup_p_proc/look_at_p_proc - is
    // not a dialog node. Side-effect-only targets are still kept because a node routes to
    // them (they are reached via an option/call edge, so the inbound edge never dangles).
    const reachable = new Set<string>();
    const queue = [...entryPoints];
    while (queue.length > 0) {
        const name = queue.shift()!;
        if (reachable.has(name)) continue;
        reachable.add(name);
        const node = parsed.get(name);
        if (!node) continue;
        for (const opt of node.options) if (opt.target) queue.push(opt.target);
        for (const t of node.callTargets) queue.push(t);
    }
    for (const [procName, node] of parsed) {
        if (reachable.has(procName)) nodes.push(node);
    }

    return { nodes, entryPoints };
}

function extractEntryPoints(proc: SyntaxNode, entryPoints: string[]): void {
    // Find call statements and call expressions
    walkTree(proc, (node) => {
        if (node.type === SyntaxType.CallStmt) {
            const target = node.childForFieldName("target");
            if (target) {
                const name = target.type === SyntaxType.CallExpr ? target.childForFieldName("func")?.text : target.text;
                if (name && !entryPoints.includes(name)) {
                    entryPoints.push(name);
                }
            }
        } else if (node.type === SyntaxType.CallExpr) {
            const func = node.childForFieldName("func");
            if (func?.text.startsWith("Node") && !entryPoints.includes(func.text)) {
                entryPoints.push(func.text);
            }
        }
    });
}

function parseProcedure(proc: SyntaxNode, name: string, sideEffectFns: ReadonlySet<string>): SSLDialogNode {
    const replies: SSLDialogReply[] = [];
    const options: SSLDialogOption[] = [];
    const callTargets: string[] = [];
    // Source-ordered, deduplicated side-effect builtins this node calls. Walk order is
    // top-down, so first-occurrence order is source order.
    const sideEffects: string[] = [];

    walkTree(proc, (node) => {
        if (node.type === SyntaxType.CallExpr) {
            const funcNode = node.childForFieldName("func");
            if (!funcNode) return;

            const funcName = funcNode.text;
            const args = getCallArgs(node);
            const line = node.startPosition.row + 1;

            if (sideEffectFns.has(funcName) && !sideEffects.includes(funcName)) {
                sideEffects.push(funcName);
            }

            // Reply(msgId)
            const arg0 = args[0];
            const arg1 = args[1];
            const arg2 = args[2];

            if (funcName === "Reply" && arg0) {
                replies.push({
                    msgId: parseArgValue(arg0),
                    line,
                    conditional: enclosingCondition(node),
                    msgKind: classifyMsgId(arg0),
                });
            }

            // NOption, GOption, BOption, and Low variants - narrows funcName.
            if (isOptionFn(funcName) && arg0 && arg1) {
                const target = arg1.text;
                options.push({
                    type: funcName,
                    msgId: parseArgValue(arg0),
                    target,
                    skill: arg2 ? parseInt(arg2.text, 10) : undefined,
                    line,
                    conditional: enclosingCondition(node),
                    msgKind: classifyMsgId(arg0),
                });
            }

            // NMessage, GMessage, BMessage (terminal) - narrows funcName.
            if (isMessageFn(funcName) && arg0) {
                options.push({
                    type: funcName,
                    msgId: parseArgValue(arg0),
                    target: "",
                    line,
                    conditional: enclosingCondition(node),
                    msgKind: classifyMsgId(arg0),
                });
            }
        }

        // Collect "call Node*" statements as direct transitions
        if (node.type === SyntaxType.CallStmt) {
            const target = node.childForFieldName("target");
            if (target) {
                const targetName =
                    target.type === SyntaxType.CallExpr ? target.childForFieldName("func")?.text : target.text;
                // Keep any resolved call target, not just Node* - `call combat`/`call barter`
                // are real transitions out of the dialog.
                if (targetName && !callTargets.includes(targetName)) {
                    callTargets.push(targetName);
                }
            }
        }
    });

    return {
        name,
        line: proc.startPosition.row + 1,
        replies,
        options,
        callTargets,
        faithful: isFaithfulProcedure(proc),
        // Omit when empty so nodes without detected side-effects stay clean in the IR.
        ...(sideEffects.length > 0 ? { sideEffects } : {}),
    };
}

// Recognized dialog calls the graph represents and the (Tier 2+) serializer can reproduce:
// Reply / N*Option,G*Option,B*Option (+Low) / N*Message,G*Message,B*Message. A `call Node;`
// transition is handled separately (it is a CallStmt, not a call expression).
function isDialogCallExpr(callExpr: SyntaxNode): boolean {
    const fn = callExpr.childForFieldName("func")?.text;
    if (!fn) return false;
    return fn === "Reply" || isOptionFn(fn) || isMessageFn(fn);
}

/**
 * Whether a single procedure-body statement is faithfully representable. `allowIf` is true at
 * the procedure's top level and false inside an `if` body, so a nested `if` is rejected (only
 * single-level `if` is faithful). Conservative: anything not explicitly allowed is unfaithful.
 */
function isFaithfulStatement(stmt: SyntaxNode, allowIf: boolean): boolean {
    switch (stmt.type) {
        case SyntaxType.ExpressionStmt: {
            // An expression statement is faithful only when its expression is a recognized dialog call.
            const expr = stmt.namedChildren[0];
            return expr !== null && expr !== undefined && expr.type === SyntaxType.CallExpr && isDialogCallExpr(expr);
        }
        case SyntaxType.CallStmt:
            // `call Node;` / `call combat;` - a dialog transition.
            return true;
        case SyntaxType.IfStmt: {
            if (!allowIf) return false; // nested if -> not faithful
            if (stmt.childForFieldName("else") !== null) return false; // else -> not faithful
            const thenBody = stmt.childForFieldName("then");
            if (!thenBody) return false;
            return isFaithfulBranch(thenBody);
        }
        default:
            // while/for/foreach/switch/assignment/variable_decl/return/... - not representable.
            return false;
    }
}

// A `then` branch is either a single statement or a `begin ... end` block of statements; every
// contained statement must itself be faithful, and `if`s inside it are nested (allowIf = false).
function isFaithfulBranch(branch: SyntaxNode): boolean {
    if (branch.type === SyntaxType.Block) {
        return branch.children.filter((c) => c.isNamed).every((c) => isFaithfulStatement(c, false));
    }
    return isFaithfulStatement(branch, false);
}

function isFaithfulProcedure(proc: SyntaxNode): boolean {
    return proc.childrenForFieldName("body").every((stmt) => isFaithfulStatement(stmt, true));
}

function getCallArgs(callExpr: SyntaxNode): SyntaxNode[] {
    // namedChildren[0] is the func, rest are args
    return callExpr.namedChildren.slice(1);
}

function parseArgValue(node: SyntaxNode): number | string {
    if (node.type === SyntaxType.Number) {
        return parseInt(node.text, 10);
    }
    return node.text;
}

/**
 * Classify a message-id argument for the honesty badges. A plain numeric literal is a
 * fixed id (undefined - no badge). A `random(...)` call yields one of several lines at
 * runtime (`random`). Anything else (a variable, an expression) is `computed` - the
 * shown line is approximate because the real id is only known at runtime.
 */
function classifyMsgId(node: SyntaxNode): "computed" | "random" | undefined {
    if (node.type === SyntaxType.Number) return undefined;
    if (node.type === SyntaxType.CallExpr) {
        return node.childForFieldName("func")?.text === "random" ? "random" : "computed";
    }
    return "computed";
}

/**
 * Walk up from a dialog call to the nearest enclosing `if`, returning its
 * condition text. The SSL derived graph is read-only and approximate, so a
 * conditional reply/option must be marked rather than shown as unconditional.
 */
function enclosingCondition(node: SyntaxNode): string | undefined {
    // Track the child we ascend through so that at an `if` we can tell whether the call sits in
    // the `then` branch (runs on the condition) or the `else` branch (runs on its negation). The
    // grammar fields are `cond` / `then` / `else`; an option in the else branch was previously
    // mislabeled with the bare `cond`.
    let prev: SyntaxNode = node;
    let cur: SyntaxNode | null = node.parent;
    while (cur) {
        if (cur.type === SyntaxType.IfStmt) {
            const cond = cur.childForFieldName("cond")?.text;
            if (cond === undefined) return undefined;
            const elseBody = cur.childForFieldName("else");
            // Compare by byte span, not reference: web-tree-sitter returns fresh wrapper objects
            // for the same node, so `prev === elseBody` is never true. SSL conditions are
            // parenthesized (`if (X)`), so `!cond` is already well-formed.
            const inElse =
                elseBody !== null && prev.startIndex === elseBody.startIndex && prev.endIndex === elseBody.endIndex;
            return inElse ? `!${cond}` : cond;
        }
        prev = cur;
        cur = cur.parent;
    }
    return undefined;
}

function walkTree(node: SyntaxNode, callback: (_node: SyntaxNode) => void): void {
    callback(node);
    for (const child of node.children) {
        walkTree(child, callback);
    }
}
