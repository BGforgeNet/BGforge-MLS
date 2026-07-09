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
import { conlog } from "../logger";
import type {
    SSLDialogBlock,
    SSLDialogBlockItem,
    SSLDialogBranch,
    SSLDialogData,
    SSLDialogGroup,
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
function msgIdOf(arg: Node): { msgId: number | string; msgKind?: "computed" | "random" } {
    if (arg.getKind() === SyntaxKind.NumericLiteral) return { msgId: Number(arg.getText()) };
    if (Node.isCallExpression(arg)) {
        return { msgId: arg.getText(), msgKind: calleeName(arg) === "random" ? "random" : "computed" };
    }
    return { msgId: arg.getText(), msgKind: "computed" };
}

interface IfSpans {
    condition: string;
    condRange: { start: number; end: number };
    ifRange: { start: number; end: number };
    ifPure: boolean;
}

/** Number of real statements in an `if`'s then-branch (a block's statements, or 1 for a bare statement). */
function branchStatementCount(thenStmt: Node): number {
    if (Node.isBlock(thenStmt)) return thenStmt.getStatements().filter((s) => !Node.isEmptyStatement(s)).length;
    return 1;
}

/**
 * The nearest enclosing single-level `if (cond) { ... }` whose then-branch directly contains this call, or
 * undefined when the call is unconditional, in an `else`, or MULTI-level nested (a second enclosing `if` can't
 * round-trip to one condition, so it stays read-only). Mirrors `server/src/dialog.ts` `enclosingIfSpans` over
 * the TS AST. `condRange` covers the condition expression (between `if (` and `)`); `ifRange` the whole `if`;
 * `ifPure` is true iff the then-branch holds this call ALONE - the only condition-editable shape.
 */
function enclosingIfSpans(call: CallExpression): IfSpans | undefined {
    let inner: IfSpans | undefined;
    let cur: Node | undefined = call.getParent();
    while (cur && !Node.isFunctionDeclaration(cur)) {
        if (Node.isIfStatement(cur)) {
            if (inner) return undefined; // a second enclosing `if` -> multi-level, not round-trippable
            if (cur.getElseStatement()) return undefined; // else -> not a pure single-level gate
            const thenStmt = cur.getThenStatement();
            // The call must sit inside the THEN branch (not the condition or an else).
            if (call.getStart() < thenStmt.getStart() || call.getEnd() > thenStmt.getEnd()) return undefined;
            const cond = cur.getExpression();
            inner = {
                condition: cond.getText(),
                condRange: span(cond),
                ifRange: span(cur),
                ifPure: branchStatementCount(thenStmt) === 1,
            };
        }
        cur = cur.getParent();
    }
    return inner;
}

/**
 * Walk up from a dialog call to the procedure body, conjoining EVERY enclosing `if` condition (not just the
 * nearest). A doubly-nested option is gated by all its ancestors; returning only the innermost silently drops
 * the outer gates (dialog-nested-flatten-bug-class, symptom 1). Mirrors `server/src/dialog.ts` `enclosingCondition`
 * over the TS AST: parts are joined outermost-first with ` and `, an `else`-branch level negated with `not `. The
 * condition tokens are TS syntax (`x == 1`), but the composition (join/negate) matches the SSL parser so the two
 * families render an equivalent dialog identically (the flat projection is display-only; the string never round-
 * trips - a single-level editable gate is rewritten through `condRange`, not this text). When `skip` holds an
 * `if`'s `start:end` key, that level is omitted - used to drop the state-level gate (the `if`s the first Reply also
 * sits under, already shown as the state trigger) so it is not re-shown on every child option.
 */
function enclosingConditionTSSL(call: Node, skip?: ReadonlySet<string>): string | undefined {
    const parts: string[] = [];
    let prev: Node = call;
    let cur: Node | undefined = call.getParent();
    while (cur && !Node.isFunctionDeclaration(cur)) {
        if (Node.isIfStatement(cur) && !skip?.has(`${cur.getStart()}:${cur.getEnd()}`)) {
            const cond = cur.getExpression().getText();
            const elseStmt = cur.getElseStatement();
            // The call sits in the `else` branch (runs on the negation) iff we ascended through the else node.
            const inElse =
                elseStmt !== undefined &&
                prev.getStart() === elseStmt.getStart() &&
                prev.getEnd() === elseStmt.getEnd();
            parts.push(inElse ? `not ${cond}` : cond);
        }
        prev = cur;
        cur = cur.getParent();
    }
    if (parts.length === 0) return undefined;
    parts.reverse(); // innermost-first -> present outermost-first so the composite gate reads top-down
    return parts.length === 1 ? parts[0]! : parts.join(" and ");
}

/**
 * `start:end` keys of every enclosing `if` of `node`, up to the procedure body - identifies the exact `if`
 * nodes so a caller can subtract a state-level gate by node identity (robust against two `if`s sharing the same
 * condition text). Mirrors `server/src/dialog.ts` `enclosingIfKeys`.
 */
function enclosingIfKeysTSSL(node: Node): ReadonlySet<string> {
    const keys = new Set<string>();
    let cur: Node | undefined = node.getParent();
    while (cur && !Node.isFunctionDeclaration(cur)) {
        if (Node.isIfStatement(cur)) keys.add(`${cur.getStart()}:${cur.getEnd()}`);
        cur = cur.getParent();
    }
    return keys;
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

/**
 * A non-dialog statement the bundle/structured tiers keep byte-exact without modeling it: an assignment or
 * local declaration (`x = 1`, `let x = 1`), or an expression statement whose call is NOT a recognized dialog
 * call/transition (a side-effect builtin like `set_local_var`). No control flow. Mirrors the SSL parser's
 * `isPreservableSimpleStatement`; the two families share the SSL-in-TS call vocabulary, so the only shape TS
 * adds is the `let`/`const` variable statement.
 */
function isPreservableSimpleStmt(stmt: Node, localFns: ReadonlySet<string>): boolean {
    if (Node.isVariableStatement(stmt)) return true;
    if (!Node.isExpressionStatement(stmt)) return false;
    // Any simple expression statement that is not a dialog/transition call - an assignment expression or a
    // side-effect builtin call - is preserved opaque. Control flow (if/while/for/switch) is not an
    // ExpressionStatement, so it is correctly excluded here and handled by the recursive structured gate.
    return !isDialogOrTransitionStmt(stmt, localFns);
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

/**
 * Structured: a dialog/transition call, a preservable simple statement (assignment / side-effect call), or an
 * `if`/`else` whose branches are themselves structured (RECURSIVE - unlike the bundle gate, which rejects any
 * nested `if`). No loop/switch/return-branching. Mirrors the SSL parser's `isStructuredStatement`; the 3-tier
 * parser rejected any statement that was not a call expression, demoting a node with a bare assignment to lossy
 * `approximate` where the SSL parser keeps it structured.
 */
function isStructuredStmt(stmt: Node, localFns: ReadonlySet<string>): boolean {
    if (Node.isExpressionStatement(stmt) || Node.isVariableStatement(stmt)) return true;
    if (Node.isIfStatement(stmt)) {
        const elseStmt = stmt.getElseStatement();
        return (
            isStructuredBranch(stmt.getThenStatement(), localFns) &&
            (!elseStmt || isStructuredBranch(elseStmt, localFns))
        );
    }
    return false; // for/while/switch/... -> not structured
}

function isStructuredBranch(branch: Node, localFns: ReadonlySet<string>): boolean {
    if (Node.isBlock(branch)) return branch.getStatements().every((s) => isStructuredStmt(s, localFns));
    return isStructuredStmt(branch, localFns);
}

/** A statement usable inside a bundle branch: a dialog/transition call or a preservable simple statement. No
 * nested `if` (an IfStatement is neither) - that would make the node structured, not bundle. */
function isBundleBranchStmt(stmt: Node, localFns: ReadonlySet<string>): boolean {
    return isDialogOrTransitionStmt(stmt, localFns) || isPreservableSimpleStmt(stmt, localFns);
}

/** A bundle branch body (a block or a single bare statement): every statement is a bundle-branch statement. */
function isBundleBranch(branch: Node, localFns: ReadonlySet<string>): boolean {
    return branchStmtsTSSL(branch).every((s) => isBundleBranchStmt(s, localFns));
}

/**
 * Bundle: the body is ONLY top-level single-level `if`s (each with an optional `else`) whose branches are
 * bundle branches - editable, one condition per branch. Mirrors the SSL parser's `isBundleFaithfulProcedure`
 * (a top-level flat call or a nested `if` disqualifies the node - those are faithful and structured
 * respectively). Caller checks this only when the node is not plain-faithful, keeping the tiers exclusive.
 */
function isBundleProc(fn: FunctionDeclaration, localFns: ReadonlySet<string>): boolean {
    const stmts = fn.getStatements();
    if (stmts.length === 0) return false;
    for (const stmt of stmts) {
        if (!Node.isIfStatement(stmt)) return false;
        if (!isBundleBranch(stmt.getThenStatement(), localFns)) return false;
        const elseStmt = stmt.getElseStatement();
        if (elseStmt && !isBundleBranch(elseStmt, localFns)) return false;
    }
    return true;
}

function classifyTier(
    fn: FunctionDeclaration,
    localFns: ReadonlySet<string>,
): "faithful" | "bundle" | "structured" | "approximate" {
    const stmts = fn.getStatements();
    // Tiers are mutually exclusive, checked most-faithful first: faithful (flat, editable) > bundle (single-
    // level if/else, editable) > structured (arbitrarily nested, read-only) > approximate (lossy). Parity with
    // server/src/dialog.ts.
    if (stmts.every((s) => isFaithfulStmt(s, true, localFns))) return "faithful";
    if (isBundleProc(fn, localFns)) return "bundle";
    if (stmts.every((s) => isStructuredStmt(s, localFns))) return "structured";
    return "approximate";
}

/** A branch body's statements: a block's statements, or the single bare statement (a bare `if`/call). */
function branchStmtsTSSL(branch: Node): Node[] {
    return Node.isBlock(branch) ? branch.getStatements() : [branch];
}

/**
 * Build the recursive block for a structured node, mirroring `server/src/dialog.ts` `buildBlock` over the TS AST.
 * Leaf items reference the flat replies/options/callTransitions arrays by source-order index; `counters` advances
 * in the SAME preorder the flat walk (`buildNode`'s `forEachDescendant`) uses - top-level statements in order,
 * each group's `then` before its `else` - so the Nth Reply here indexes replies[N], the Nth option/message
 * options[N], the Nth local-function transition callTransitions[N]. Non-dialog statements become opaque items.
 */
function buildBlockTSSL(
    stmts: readonly Node[],
    localFns: ReadonlySet<string>,
    counters: { reply: number; opt: number; trans: number },
): SSLDialogBlock {
    const items: SSLDialogBlockItem[] = [];
    for (const stmt of stmts) {
        if (Node.isIfStatement(stmt)) {
            const cond = stmt.getExpression();
            const thenStmt = stmt.getThenStatement();
            const elseStmt = stmt.getElseStatement();
            const group: SSLDialogGroup = {
                kind: "group",
                condition: cond.getText(),
                conditionRange: span(cond),
                thenBlock: buildBlockTSSL(branchStmtsTSSL(thenStmt), localFns, counters),
                ...(elseStmt ? { elseBlock: buildBlockTSSL(branchStmtsTSSL(elseStmt), localFns, counters) } : {}),
            };
            items.push(group);
            continue;
        }
        if (Node.isExpressionStatement(stmt)) {
            const expr = stmt.getExpression();
            if (Node.isCallExpression(expr)) {
                const cn = calleeName(expr);
                if (cn === "Reply") {
                    items.push({ kind: "line", replyIndex: counters.reply++ });
                    continue;
                }
                if (cn !== undefined && (isOptionFn(cn) || isMessageFn(cn))) {
                    items.push({ kind: "choice", optionIndex: counters.opt++ });
                    continue;
                }
                if (cn !== undefined && localFns.has(cn)) {
                    items.push({ kind: "transition", transitionIndex: counters.trans++ });
                    continue;
                }
            }
        }
        // A preservable simple statement (assignment / side-effect call) the block keeps byte-exact.
        items.push({ kind: "opaque", text: stmt.getText(), textRange: span(stmt) });
    }
    return items;
}

/** Splice point for a new option at the end of a bundle branch block: end of the last statement + that line's
 * indent; an empty block anchors just inside `{`. Only called for block branches (a bare single-statement
 * branch carries no insertAnchor, so add is a no-op there - mirrors the SSL parser). */
function branchInsertAnchorTSSL(block: Node, text: string): { offset: number; indent: string } {
    const stmts = Node.isBlock(block) ? block.getStatements() : [];
    const last = stmts.at(-1);
    if (!last) return { offset: block.getStart() + 1, indent: "        " };
    const lineStart = text.lastIndexOf("\n", last.getStart() - 1) + 1;
    const indent = /^[ \t]*/.exec(text.slice(lineStart, last.getStart()))?.[0] ?? "        ";
    return { offset: last.getEnd(), indent };
}

/**
 * Group a bundle node's body into ordered branches, mirroring `server/src/dialog.ts` `buildBranches` over the
 * TS AST. The body is only top-level `if`s (the bundle gate), so each yields an "if" branch (its then-body)
 * and, when present, an "else" branch. Dialog calls are matched to the flat replies/options arrays by source
 * order: both this walk and `buildNode`'s `forEachDescendant` are preorder (each if's then before its else),
 * so the Nth Reply -> replies[N], the Nth option/message -> options[N]. Non-dialog statements (assignments,
 * side-effect calls, transitions) become opaque items preserved byte-exact on save.
 */
function buildBranchesTSSL(fn: FunctionDeclaration): SSLDialogBranch[] {
    const text = fn.getSourceFile().getFullText();
    const branches: SSLDialogBranch[] = [];
    let replyIdx = 0;
    let optIdx = 0;

    const collectBody = (branch: SSLDialogBranch, body: Node): void => {
        for (const stmt of branchStmtsTSSL(body)) {
            if (Node.isExpressionStatement(stmt)) {
                const expr = stmt.getExpression();
                if (Node.isCallExpression(expr)) {
                    const cn = calleeName(expr);
                    if (cn === "Reply") {
                        branch.replyIndices.push(replyIdx++);
                        continue;
                    }
                    if (cn !== undefined && (isOptionFn(cn) || isMessageFn(cn))) {
                        branch.optionIndices.push(optIdx++);
                        continue;
                    }
                }
            }
            branch.opaque.push({ text: stmt.getText(), textRange: span(stmt) });
        }
    };

    for (const stmt of fn.getStatements()) {
        if (!Node.isIfStatement(stmt)) continue; // bundle guarantees every top-level statement is an if
        const cond = stmt.getExpression();
        const thenStmt = stmt.getThenStatement();
        const ifBranch: SSLDialogBranch = {
            kind: "if",
            condition: cond.getText(),
            conditionRange: span(cond),
            stmtRange: span(stmt),
            replyIndices: [],
            optionIndices: [],
            opaque: [],
        };
        collectBody(ifBranch, thenStmt);
        if (Node.isBlock(thenStmt)) {
            ifBranch.insertAnchor = branchInsertAnchorTSSL(thenStmt, text);
            // Offset right after the then-block's `}` - where ` else { ... }` is appended when adding an else.
            ifBranch.thenBlockEnd = thenStmt.getEnd();
        }
        branches.push(ifBranch);

        const elseStmt = stmt.getElseStatement();
        if (elseStmt) {
            const elseBranch: SSLDialogBranch = { kind: "else", replyIndices: [], optionIndices: [], opaque: [] };
            collectBody(elseBranch, elseStmt);
            if (Node.isBlock(elseStmt)) elseBranch.insertAnchor = branchInsertAnchorTSSL(elseStmt, text);
            // The `else` keyword through the else body's end - for deleting just the else clause. Located by text
            // search after the then-block end (mirrors the SSL parser); the `else` token is unambiguous there.
            const elseKw = text.indexOf("else", thenStmt.getEnd());
            elseBranch.elseClauseRange = { start: elseKw, end: elseStmt.getEnd() };
            branches.push(elseBranch);
        }
    }
    return branches;
}

// ---------------------------------------------------------------------------
// Node builder
// ---------------------------------------------------------------------------

function buildNode(fn: FunctionDeclaration, name: string, localFns: ReadonlySet<string>): SSLDialogNode {
    const replies: SSLDialogReply[] = [];
    const options: SSLDialogOption[] = [];
    const callTargets: string[] = [];
    const callTransitions: NonNullable<SSLDialogNode["callTransitions"]> = [];
    const body = fn.getBody();

    // The state's own gate: the enclosing `if`s of the FIRST Reply (whatever becomes state.trigger). Options
    // scope their displayed condition to their own state by subtracting these. Pre-scanned so it is known before
    // any option is processed - a Reply usually precedes its options, but the walk order is not relied upon.
    let firstReply: Node | undefined;
    fn.forEachDescendant((node, traversal) => {
        if (Node.isCallExpression(node) && calleeName(node) === "Reply" && node.getArguments()[0]) {
            firstReply = node;
            traversal.stop();
        }
    });
    const stateGate = firstReply ? enclosingIfKeysTSSL(firstReply) : undefined;

    // Full-subtree walk so a nested dialog call is never dropped (the content-faithfulness invariant).
    fn.forEachDescendant((node) => {
        if (!Node.isCallExpression(node)) return;
        const cn = calleeName(node);
        if (cn === undefined) return;
        const args = node.getArguments();
        const arg0 = args[0];
        const line = node.getStartLineNumber();
        if (cn === "Reply" && arg0) {
            // `conditional` conjoins EVERY enclosing `if` (multi-level); the `if*` edit anchors come from the
            // single-level `enclosingIfSpans` and are present only for a pure single-level gate.
            const ifSpans = enclosingIfSpans(node);
            const conditional = enclosingConditionTSSL(node);
            replies.push({
                ...msgIdOf(arg0),
                line,
                ...(conditional !== undefined ? { conditional } : {}),
                ...(ifSpans ? { condRange: ifSpans.condRange, ifRange: ifSpans.ifRange, ifPure: ifSpans.ifPure } : {}),
            });
        } else if (isOptionFn(cn) && arg0 && args[1]) {
            const arg1 = args[1];
            const ifSpans = enclosingIfSpans(node);
            const conditional = enclosingConditionTSSL(node);
            const scoped = enclosingConditionTSSL(node, stateGate);
            options.push({
                type: cn,
                ...msgIdOf(arg0),
                target: arg1.getText(),
                skill: args[2] ? Number(args[2].getText()) : undefined,
                line,
                ...(conditional !== undefined ? { conditional } : {}),
                ...(scoped !== undefined ? { scopedConditional: scoped } : {}),
                ...(ifSpans ? { condRange: ifSpans.condRange, ifRange: ifSpans.ifRange, ifPure: ifSpans.ifPure } : {}),
                callRange: span(node),
                targetRange: span(arg1),
                stmtRange: stmtSpan(node),
            });
        } else if (isMessageFn(cn) && arg0) {
            // A terminal message has no target node, but it can still be conditionally gated (Message-branch
            // parity with the SSL parser, which the old single-level TSSL parser omitted entirely).
            const conditional = enclosingConditionTSSL(node);
            const scoped = enclosingConditionTSSL(node, stateGate);
            options.push({
                type: cn,
                ...msgIdOf(arg0),
                target: "",
                line,
                ...(conditional !== undefined ? { conditional } : {}),
                ...(scoped !== undefined ? { scopedConditional: scoped } : {}),
                stmtRange: stmtSpan(node),
            });
        } else if (localFns.has(cn)) {
            // A call to another node is a transition. `callTargets` dedupes (one graph edge / call-choice per
            // target). `callTransitions` records every STATEMENT-level site (span for delete, target token for
            // rename, top-level flag) so the structured block can index it in lockstep with this flat walk - a
            // localFn call nested in an if-CONDITION (not a statement) is excluded so the two walks stay aligned.
            if (!callTargets.includes(cn)) callTargets.push(cn);
            const stmt = node.getFirstAncestorByKind(SyntaxKind.ExpressionStatement);
            if (stmt !== undefined && stmt.getExpression() === node) {
                const expr = node.getExpression();
                callTransitions.push({
                    name: cn,
                    stmtRange: span(stmt),
                    ...(expr.getKind() === SyntaxKind.Identifier ? { targetRange: span(expr) } : {}),
                    topLevel: body !== undefined && stmt.getParent() === body,
                });
            }
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
        ...(callTransitions.length > 0 ? { callTransitions } : {}),
        faithful: tier === "faithful",
        // A bundle node carries its ordered if/else branches so the editor renders per-branch grouping and can
        // add/remove options and branches - editable parity with the SSL bundle tier (the 3-tier parser demoted
        // an if/else dialog node to read-only structured).
        ...(tier === "bundle" ? { bundleFaithful: true as const, branches: buildBranchesTSSL(fn) } : {}),
        // A structured node carries the recursive block mirroring its body so nested if/else render faithfully
        // (rather than the empty block the old parser left, which made a structured node show no nested content).
        ...(tier === "structured"
            ? {
                  structured: true as const,
                  block: buildBlockTSSL(fn.getStatements(), localFns, { reply: 0, opt: 0, trans: 0 }),
              }
            : {}),
        ...(tier === "approximate" ? { approximate: true as const } : {}),
        procRange: span(fn),
        ...(nameNode ? { nameRange: span(nameNode) } : {}),
    };
}

/**
 * Parse TSSL source into SSL DialogData with byte ranges into the `.tssl` source: nodes (name, replies,
 * options with multi-level conditions, callTargets/callTransitions, faithfulness tier, bundle `branches`,
 * structured `block`, procRange/nameRange), entry points, entry-call and new-node write-back anchors, and
 * out-of-band starts. At FULL parity with the native SSL parser (`server/src/dialog.ts`): the same four
 * mutually-exclusive tiers (faithful > bundle > structured > approximate), the same preservable-simple-
 * statement handling (assignments/side-effects kept opaque), and the same reachability/`*_p_proc` hook
 * node-inclusion filter. Faithful and bundle nodes are editable (bundle branch edits round-trip via
 * `applyTSSLDialogEdits`); a structured node renders faithfully but read-only; approximate is lossy.
 */
export function parseTSSLSource(text: string): SSLDialogData {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile("dialog.tssl.ts", text);
    // The TS parser never throws on malformed input, but its error recovery is not local: an unclosed brace
    // can swallow every following function into one misnested body, silently re-parenting nodes and shifting
    // the splice anchors the write-back relies on. Unlike tree-sitter's localized ERROR nodes (which the
    // .d/.ssl bridges tolerate), anchors from an errored TS parse are untrustworthy - so degrade to the empty
    // model like the siblings' no-tree guard, logged at warn so the degrade is diagnosable.
    const syntaxErrors = project.getProgram().getSyntacticDiagnostics(sf);
    if (syntaxErrors.length > 0) {
        conlog(
            `parseTSSLSource: ${syntaxErrors.length} syntax error(s) in TSSL source; returning empty dialog`,
            "warn",
        );
        return { nodes: [], entryPoints: [] };
    }
    const fns = sf.getFunctions();
    const localFns = new Set<string>(fns.map((f) => f.getName()).filter((n): n is string => n !== undefined));

    // Parse every dialog procedure into a map first (source order preserved); the reachability/hook filter
    // below decides which become emitted `nodes`, mirroring the SSL parser's two-pass structure.
    const parsed = new Map<string, SSLDialogNode>();
    const entryPoints: string[] = [];
    const procNames: string[] = [];
    const entryCalls: NonNullable<SSLDialogData["entryCalls"]> = [];
    let newProcAnchor: number | undefined;
    let entryCallAnchor: number | undefined;
    for (const fn of fns) {
        const name = fn.getName();
        if (name === undefined) continue;
        if (name === TALK_PROC) {
            // Entry router: record each `NodeNNN();` call in talk_p_proc with its statement + target spans, so a
            // node rename/delete can rewrite/remove the entry call. `newProcAnchor` (a new node is spliced just
            // before the router) and `entryCallAnchor` (a new entry call is appended after the last body
            // statement) mirror the SSL parser's write-back anchors.
            newProcAnchor = fn.getStart();
            const body = fn.getBody();
            const bodyStmts = body && Node.isBlock(body) ? body.getStatements() : [];
            entryCallAnchor = bodyStmts.length > 0 ? bodyStmts[bodyStmts.length - 1]!.getEnd() : fn.getStart();
            fn.forEachDescendant((node) => {
                if (!Node.isCallExpression(node)) return;
                const cn = calleeName(node);
                if (cn === undefined || !localFns.has(cn)) return;
                if (!entryPoints.includes(cn)) entryPoints.push(cn);
                // topLevel: the call's own statement is a direct child of the router body (not nested in an if),
                // so it can be removed without leaving a dangling conditional (mirrors the SSL entry-call guard).
                const stmt = node.getFirstAncestorByKind(SyntaxKind.ExpressionStatement);
                const topLevel = stmt !== undefined && stmt.getParent() === body;
                entryCalls.push({
                    name: cn,
                    stmtRange: stmtSpan(node),
                    targetRange: span(node.getExpression()),
                    topLevel,
                });
            });
            continue;
        }
        procNames.push(name);
        parsed.set(name, buildNode(fn, name, localFns));
    }
    // force_dialog_start(Node) / start_dialog_at_node(Node) reached from ANYWHERE (timers, map-enter handlers)
    // start a conversation out of band; treat their targets as entry points and capture the target-identifier
    // span so a node rename rewrites it, or the saved file dangles at the old name. Mirrors the SSL parser.
    // (TS has no forward-declaration construct - function declarations hoist - so unlike the SSL parser there is
    // no `procedure Name;` name token to record for rename; `forwardDeclRange` is legitimately absent for TSSL.)
    const outOfBandCalls: NonNullable<SSLDialogData["outOfBandCalls"]> = [];
    sf.forEachDescendant((node) => {
        if (!Node.isCallExpression(node)) return;
        const cn = calleeName(node);
        if (cn !== "force_dialog_start" && cn !== "start_dialog_at_node") return;
        const arg = node.getArguments()[0];
        if (arg === undefined) return;
        const targetName = Node.isCallExpression(arg) ? calleeName(arg) : arg.getText();
        if (targetName === undefined) return;
        if (!entryPoints.includes(targetName)) entryPoints.push(targetName);
        // A call_expr arg has no single target token to splice, so it is left name-only (not a renamable node id).
        if (!Node.isCallExpression(arg)) outOfBandCalls.push({ name: targetName, targetRange: span(arg) });
    });
    // Node inclusion (SSL parity): keep a procedure reachable from a dialog entry (talk_p_proc calls +
    // force_dialog_start targets, following option/call transitions), OR an unreachable-but-authored orphan
    // dialog node (has a Reply/option and is not an engine `*_p_proc` hook). A `*_p_proc` lifecycle handler is
    // never a dialog node even when it contains a Reply, so it stays excluded - the 3-tier parser emitted it as
    // a spurious dialog node. `procNames` still lists every parsed procedure (incl. hooks) for name allocation.
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
    const isHookProc = (name: string): boolean => name.endsWith("_p_proc");
    const nodes: SSLDialogNode[] = [];
    for (const [name, node] of parsed) {
        const isOrphanDialogNode = !isHookProc(name) && (node.replies.length > 0 || node.options.length > 0);
        if (reachable.has(name) || isOrphanDialogNode) nodes.push(node);
    }
    return {
        nodes,
        entryPoints,
        procNames,
        ...(entryCalls.length > 0 ? { entryCalls } : {}),
        ...(newProcAnchor !== undefined ? { newProcAnchor } : {}),
        ...(entryCallAnchor !== undefined ? { entryCallAnchor } : {}),
        ...(outOfBandCalls.length > 0 ? { outOfBandCalls } : {}),
    };
}
