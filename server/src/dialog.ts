/**
 * Dialog parser for Fallout SSL scripts using tree-sitter.
 * Extracts dialog structure (nodes, replies, options) for visualization.
 */

import type { Node as SyntaxNode } from "web-tree-sitter";
import { initParser, parseWithCache, isInitialized } from "../../shared/parsers/fallout-ssl";
import { conlog } from "./logger";
import { SyntaxType } from "./fallout-ssl/syntax-type";
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
        // Deliberate degrade to an empty model (blank dialog rather than a thrown request); logged at warn
        // (operator-visible output channel) so a failed parse is diagnosable, not silently an empty dialog.
        conlog("parseDialog: fallout-ssl parse produced no tree; returning empty dialog", "warn");
        return { nodes: [], entryPoints: [] };
    }
    const root = tree.rootNode;

    const nodes: SSLDialogNode[] = [];
    const entryPoints: string[] = [];
    // Where a newly-added node's procedure is spliced in: just before talk_p_proc, so it lands among
    // the dialog procedures rather than after the entry router. Undefined when there is no talk_p_proc.
    let newProcAnchor: number | undefined;
    // Each `call <entry>;` statement in talk_p_proc (for entry add/delete operations).
    let entryCalls:
        | Array<{
              name: string;
              stmtRange: { start: number; end: number };
              targetRange: { start: number; end: number };
              topLevel: boolean;
          }>
        | undefined;
    // Byte offset where a NEW entry call is spliced into talk_p_proc (end of its last body statement).
    let entryCallAnchor: number | undefined;
    // Each `force_dialog_start(Node)` / `start_dialog_at_node(Node)` call reached from OUTSIDE talk_p_proc
    // (timers, map-enter handlers). Only the target-identifier span is captured (a call_expr target has no plain
    // token to splice) so a node rename can rewrite the argument, or the saved file dangles at the old name.
    const outOfBandCalls: Array<{ name: string; targetRange: { start: number; end: number } }> = [];

    // Forward declarations (`procedure Name;`) carry a name token that a rename must also rewrite, or the
    // file is left with an orphan decl for the old name and the renamed procedure undeclared. Capture each
    // decl's name-token span by procedure name (first wins - a redeclaration is invalid SSL anyway).
    const forwardDeclRanges = new Map<string, { start: number; end: number }>();
    // Full `procedure Name;` statement span (not just the name token) so a node DELETE can splice the whole
    // forward declaration out - removing only the name token would leave a broken `procedure ;`.
    const forwardDeclStmtRanges = new Map<string, { start: number; end: number }>();
    for (const child of root.children) {
        if (child.type !== SyntaxType.ProcedureForward) continue;
        const nameNode = child.childForFieldName("name");
        if (nameNode && !forwardDeclRanges.has(nameNode.text)) {
            forwardDeclRanges.set(nameNode.text, { start: nameNode.startIndex, end: nameNode.endIndex });
            forwardDeclStmtRanges.set(nameNode.text, { start: child.startIndex, end: child.endIndex });
        }
    }

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
            newProcAnchor = child.startIndex;
            entryCalls = collectEntryCalls(child);
            entryCallAnchor = entryCallSpliceAnchor(child);
            continue;
        }
        const node = parseProcedure(child, procName, sideEffectFns, text);
        node.procRange = { start: child.startIndex, end: child.endIndex };
        const fwd = forwardDeclRanges.get(procName);
        if (fwd) node.forwardDeclRange = fwd;
        const fwdStmt = forwardDeclStmtRanges.get(procName);
        if (fwdStmt) node.forwardDeclStmtRange = fwdStmt;
        parsed.set(procName, node);
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
        if (!name) return;
        if (!entryPoints.includes(name)) entryPoints.push(name);
        // Capture the plain-identifier target span so a rename can rewrite it. A call_expr arg has no single
        // target token to splice, so it is left name-only (as before) - it cannot be a renamable node id anyway.
        if (arg.type !== SyntaxType.CallExpr) {
            outOfBandCalls.push({ name, targetRange: { start: arg.startIndex, end: arg.endIndex } });
        }
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
    // Include a procedure reachable from a dialog entry, OR an unreachable but authored dialog node: one that
    // has dialog calls (a Reply/option) and is not an engine hook (`*_p_proc`). The latter keeps a just-created
    // or duplicated node visible before it is wired - an orphan NodeNNN is a dialog node in progress - whereas a
    // `*_p_proc` lifecycle handler (pickup_p_proc, look_at_p_proc, ...) is never a dialog node even when it
    // contains a Reply, so it stays excluded.
    const isHookProc = (name: string): boolean => name.endsWith("_p_proc");
    for (const [procName, node] of parsed) {
        const isOrphanDialogNode = !isHookProc(procName) && (node.replies.length > 0 || node.options.length > 0);
        if (reachable.has(procName) || isOrphanDialogNode) nodes.push(node);
    }

    return {
        nodes,
        entryPoints,
        // All defined procedure names (talk_p_proc is skipped above), so new-node allocation avoids every
        // existing name, not only the projected dialog nodes.
        procNames: [...parsed.keys()],
        ...(newProcAnchor !== undefined ? { newProcAnchor } : {}),
        ...(entryCalls !== undefined ? { entryCalls } : {}),
        ...(entryCallAnchor !== undefined ? { entryCallAnchor } : {}),
        ...(outOfBandCalls.length > 0 ? { outOfBandCalls } : {}),
    };
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

// Collect all `call <identifier>;` statements in talk_p_proc, with their statement and target spans.
// Only identifier targets are included (call_expr targets have no plain target token to splice on).
function collectEntryCalls(talkProc: SyntaxNode): Array<{
    name: string;
    stmtRange: { start: number; end: number };
    targetRange: { start: number; end: number };
    topLevel: boolean;
}> {
    const result: Array<{
        name: string;
        stmtRange: { start: number; end: number };
        targetRange: { start: number; end: number };
        topLevel: boolean;
    }> = [];
    walkTree(talkProc, (node) => {
        if (node.type !== SyntaxType.CallStmt) return;
        const target = node.childForFieldName("target");
        if (!target || target.type !== SyntaxType.Identifier) return;
        const name = target.text;
        result.push({
            name,
            stmtRange: { start: node.startIndex, end: node.endIndex },
            targetRange: { start: target.startIndex, end: target.endIndex },
            topLevel: isDirectBodyChild(talkProc, node),
        });
    });
    return result;
}

// The byte offset where a NEW entry call is spliced into talk_p_proc: end of its last body statement.
// Mirrors nodeInsertAnchor's `body.at(-1)` logic but returns only the offset (no indent needed here).
function entryCallSpliceAnchor(talkProc: SyntaxNode): number | undefined {
    const body = talkProc.childrenForFieldName("body");
    const last = body.at(-1);
    return last?.endIndex;
}

// Returns true when `node` is a direct child in the `body` field of `proc`.
// web-tree-sitter returns fresh wrapper objects on every access, so identity comparison (`===`) never works;
// we match by byte span (startIndex + endIndex) instead.
function isDirectBodyChild(proc: SyntaxNode, node: SyntaxNode): boolean {
    return proc
        .childrenForFieldName("body")
        .some((s) => s.startIndex === node.startIndex && s.endIndex === node.endIndex);
}

function parseProcedure(
    proc: SyntaxNode,
    name: string,
    sideEffectFns: ReadonlySet<string>,
    fullText: string,
): SSLDialogNode {
    const replies: SSLDialogReply[] = [];
    const options: SSLDialogOption[] = [];
    const callTargets: string[] = [];
    // One entry per `call <target>;` statement (NOT deduped, unlike callTargets) carrying its byte span
    // (for delete), the target identifier span (for rename/delete-by-call), and whether the call is top-level.
    const callTransitions: Array<{
        name: string;
        stmtRange: { start: number; end: number };
        targetRange?: { start: number; end: number };
        topLevel: boolean;
    }> = [];
    // Source-ordered, deduplicated side-effect builtins this node calls. Walk order is
    // top-down, so first-occurrence order is source order.
    const sideEffects: string[] = [];

    // The state's own gate: the enclosing `if`s of the first `Reply` (whatever becomes `state.trigger`). Options
    // scope their displayed condition to their own state by subtracting these, so a state-wide `if` shown on the
    // state row is not re-shown on every child option. Pre-scanned so it is known before any option is processed
    // (a Reply usually precedes options, but the walk order is not relied upon).
    let firstReplyNode: SyntaxNode | undefined;
    walkTree(proc, (node) => {
        if (firstReplyNode) return;
        if (
            node.type === SyntaxType.CallExpr &&
            node.childForFieldName("func")?.text === "Reply" &&
            getCallArgs(node)[0]
        ) {
            firstReplyNode = node;
        }
    });
    const stateGate = firstReplyNode ? enclosingIfKeys(firstReplyNode) : undefined;

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
                const ifSpans = enclosingIfSpans(node);
                replies.push({
                    msgId: parseArgValue(arg0),
                    line,
                    conditional: enclosingCondition(node),
                    msgKind: classifyMsgId(arg0),
                    ...(ifSpans
                        ? { condRange: ifSpans.condRange, ifRange: ifSpans.ifRange, ifPure: ifSpans.ifPure }
                        : {}),
                });
            }

            // NOption, GOption, BOption, and Low variants - narrows funcName.
            if (isOptionFn(funcName) && arg0 && arg1) {
                const target = arg1.text;
                const ifSpans = enclosingIfSpans(node);
                options.push({
                    type: funcName,
                    msgId: parseArgValue(arg0),
                    target,
                    skill: arg2 ? parseInt(arg2.text, 10) : undefined,
                    line,
                    conditional: enclosingCondition(node),
                    scopedConditional: enclosingCondition(node, stateGate),
                    msgKind: classifyMsgId(arg0),
                    callRange: { start: node.startIndex, end: node.endIndex },
                    targetRange: { start: arg1.startIndex, end: arg1.endIndex },
                    stmtRange: statementRange(node),
                    ...(ifSpans
                        ? { condRange: ifSpans.condRange, ifRange: ifSpans.ifRange, ifPure: ifSpans.ifPure }
                        : {}),
                });
            }

            // NMessage, GMessage, BMessage (terminal) - narrows funcName.
            if (isMessageFn(funcName) && arg0) {
                const ifSpans = enclosingIfSpans(node);
                options.push({
                    type: funcName,
                    msgId: parseArgValue(arg0),
                    target: "",
                    line,
                    conditional: enclosingCondition(node),
                    scopedConditional: enclosingCondition(node, stateGate),
                    msgKind: classifyMsgId(arg0),
                    // A terminal message is an EXISTING statement: record its span so the editor can tell it
                    // from a newly-added option (which has no source range). Without this, a structural save
                    // re-serializes and duplicates it. No callRange/targetRange - a message has no target node.
                    stmtRange: statementRange(node),
                    ...(ifSpans
                        ? { condRange: ifSpans.condRange, ifRange: ifSpans.ifRange, ifPure: ifSpans.ifPure }
                        : {}),
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
                if (targetName) {
                    // targetRange is only set when the target is a plain identifier (not a call_expr).
                    const targetRange =
                        target.type === SyntaxType.Identifier
                            ? { start: target.startIndex, end: target.endIndex }
                            : undefined;
                    // topLevel: this call_stmt is a direct body child of the procedure.
                    // web-tree-sitter returns fresh wrapper objects, so compare by byte span, not reference.
                    const topLevel = isDirectBodyChild(proc, node);
                    // Record EVERY call site (a node may `call X;` more than once, e.g. one call per
                    // if-branch). callTransitions carries one entry per site so rename rewrites all of
                    // them and delete removes all of them; callTargets stays deduped because it drives one
                    // graph edge / one call-choice per unique target. CallStmt span includes the trailing
                    // `;` (grammar: call_stmt ends with ";").
                    callTransitions.push({
                        name: targetName,
                        stmtRange: { start: node.startIndex, end: node.endIndex },
                        ...(targetRange !== undefined ? { targetRange } : {}),
                        topLevel,
                    });
                    if (!callTargets.includes(targetName)) callTargets.push(targetName);
                }
            }
        }
    });

    const nameNode = proc.childForFieldName("name");
    const nameRange = nameNode ? { start: nameNode.startIndex, end: nameNode.endIndex } : undefined;

    const faithful = isFaithfulProcedure(proc);
    // Tiers are mutually exclusive, checked most-faithful first: faithful (flat, editable) > bundle (single-
    // level if/else, editable) > structured (arbitrarily nested, display-only) > approximate (control flow the
    // block cannot model - the flat projection is lossy, so flag it loud). See dialog-nested-flatten-bug-class.
    const bundle = !faithful && isBundleFaithfulProcedure(proc);
    const structured = !faithful && !bundle && isStructuredProcedure(proc);
    const approximate = !faithful && !bundle && !structured;
    return {
        name,
        line: proc.startPosition.row + 1,
        replies,
        options,
        callTargets,
        faithful,
        ...(bundle ? { bundleFaithful: true as const, branches: buildBranches(proc, fullText) } : {}),
        ...(structured
            ? {
                  structured: true as const,
                  block: buildBlock(proc.childrenForFieldName("body"), fullText, { reply: 0, opt: 0, trans: 0 }),
              }
            : {}),
        ...(approximate ? { approximate: true as const } : {}),
        insertAnchor: nodeInsertAnchor(proc, fullText),
        // Omit when empty so nodes without detected side-effects stay clean in the IR.
        ...(sideEffects.length > 0 ? { sideEffects } : {}),
        ...(callTransitions.length > 0 ? { callTransitions } : {}),
        ...(nameRange !== undefined ? { nameRange } : {}),
    };
}

// The whole `NOption(...);` statement span (the call's enclosing expression statement, which includes
// the trailing `;`). Used to delete an option cleanly. Falls back to the call span when the call is not
// directly wrapped in an expression statement (defensive; the faithful flat case always has one).
function statementRange(node: SyntaxNode): { start: number; end: number } {
    let cur: SyntaxNode | null = node;
    while (cur) {
        if (cur.type === SyntaxType.ExpressionStmt) return { start: cur.startIndex, end: cur.endIndex };
        cur = cur.parent;
    }
    return { start: node.startIndex, end: node.endIndex };
}

// The splice point for a new option call: the end of the procedure's last body statement, plus that
// statement's line indentation. For an empty body, anchor just after `begin` with a default 4-space indent.
function nodeInsertAnchor(proc: SyntaxNode, fullText: string): { offset: number; indent: string } {
    const body = proc.childrenForFieldName("body");
    const last = body.at(-1);
    if (last) {
        const lineStart = fullText.lastIndexOf("\n", last.startIndex - 1) + 1;
        const indent = /^[ \t]*/.exec(fullText.slice(lineStart, last.startIndex))?.[0] ?? "    ";
        return { offset: last.endIndex, indent };
    }
    // Empty body (e.g. a from-scratch scaffold's `procedure Node001 begin\nend`): anchor just AFTER the `begin`
    // keyword so a first statement lands INSIDE the procedure. `proc.startIndex` (the old value) sits before
    // `procedure`, which splices a body statement out ahead of the declaration and corrupts the file.
    // `begin` is an anonymous grammar keyword token with no SyntaxType enum member (the enum only covers named
    // nodes), so it must be matched as a raw string rather than via SyntaxType - same exemption the weidu-d
    // parser documents for its `BEGIN`/`END`/`WEIGHT` anonymous tokens.
    const begin = proc.children.find((c) => c.type === "begin");
    return { offset: begin ? begin.endIndex : proc.startIndex, indent: "    " };
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

// A non-dialog statement the bundle editor keeps byte-exact without modeling it: an assignment, or an
// expression statement whose call is NOT a recognized dialog call (a side-effect builtin like set_local_var).
// No control flow - if/while/for/switch/return make the node non-bundle.
function isPreservableSimpleStatement(stmt: SyntaxNode): boolean {
    if (stmt.type === SyntaxType.Assignment) return true;
    if (stmt.type === SyntaxType.ExpressionStmt) {
        const expr = stmt.namedChildren[0];
        return expr !== null && expr !== undefined && expr.type === SyntaxType.CallExpr && !isDialogCallExpr(expr);
    }
    return false;
}

// A statement usable as dialog inside a bundle branch: a recognized dialog call or a `call Node;` transition.
function isBundleDialogStatement(stmt: SyntaxNode): boolean {
    if (stmt.type === SyntaxType.ExpressionStmt) {
        const expr = stmt.namedChildren[0];
        return expr !== null && expr !== undefined && expr.type === SyntaxType.CallExpr && isDialogCallExpr(expr);
    }
    return stmt.type === SyntaxType.CallStmt;
}

// A bundle branch body (a `begin ... end` block or a single statement): every statement is either a dialog
// statement or a preservable simple statement. No nested `if` (an IfStmt is neither) -> rejects else-if too.
function isBundleBranch(branch: SyntaxNode): boolean {
    const stmts = branch.type === SyntaxType.Block ? branch.children.filter((c) => c.isNamed) : [branch];
    return stmts.every((s) => isBundleDialogStatement(s) || isPreservableSimpleStatement(s));
}

// A node is bundle-faithful when its body is one or more top-level single-level `if`s (optionally with one
// `else`) whose branches are bundle branches. Slice 1 requires the body to be ONLY ifs (no top-level flat
// dialog calls or assignments mixed in - deferred). Caller sets the flag only when the node is not plain-faithful.
function isBundleFaithfulProcedure(proc: SyntaxNode): boolean {
    const body = proc.childrenForFieldName("body");
    if (body.length === 0) return false;
    for (const stmt of body) {
        if (stmt.type !== SyntaxType.IfStmt) return false;
        const thenBody = stmt.childForFieldName("then");
        if (!thenBody || !isBundleBranch(thenBody)) return false;
        const elseBody = stmt.childForFieldName("else");
        if (elseBody && !isBundleBranch(elseBody)) return false;
    }
    return true;
}

// A statement representable in the recursive block model: a dialog call/transition, a preservable simple
// statement (assignment / side-effect call), or an `if`/`else` whose branches are themselves representable
// (RECURSIVE - unlike the bundle gate, which rejects any nested `if`). No loop/switch/return-branching.
function isStructuredStatement(stmt: SyntaxNode): boolean {
    if (isBundleDialogStatement(stmt)) return true;
    if (isPreservableSimpleStatement(stmt)) return true;
    if (stmt.type === SyntaxType.IfStmt) {
        const thenBody = stmt.childForFieldName("then");
        if (!thenBody || !isStructuredBranch(thenBody)) return false;
        const elseBody = stmt.childForFieldName("else");
        if (elseBody && !isStructuredBranch(elseBody)) return false;
        return true;
    }
    return false;
}

// A branch body (a `begin...end` block or a single statement) is structured when every statement is.
function isStructuredBranch(branch: SyntaxNode): boolean {
    const stmts = branch.type === SyntaxType.Block ? branch.children.filter((c) => c.isNamed) : [branch];
    return stmts.every((s) => isStructuredStatement(s));
}

// A node is structured when its whole body is representable as a recursive block (arbitrarily nested `if`/
// `else` plus interleaved dialog calls and simple statements). Caller sets the flag only when the node is
// neither plain- nor bundle-faithful, so the tiers stay mutually exclusive.
function isStructuredProcedure(proc: SyntaxNode): boolean {
    const body = proc.childrenForFieldName("body");
    if (body.length === 0) return false;
    return body.every((s) => isStructuredStatement(s));
}

// Build the recursive block for a structured node. Leaf items reference the flat replies/options/
// callTransitions arrays by source-order index; `counters` advances in the SAME preorder the flat walk
// (parseProcedure's walkTree) uses - top-level statements in order, each group's `then` before its `else` -
// so the Nth Reply here indexes replies[N], the Nth option/message options[N], the Nth `call` transition
// callTransitions[N]. Non-dialog statements become opaque items (preserved text + span).
function buildBlock(
    stmts: SyntaxNode[],
    fullText: string,
    counters: { reply: number; opt: number; trans: number },
): SSLDialogBlock {
    const items: SSLDialogBlockItem[] = [];
    for (const stmt of stmts) {
        if (stmt.type === SyntaxType.IfStmt) {
            const condNode = stmt.childForFieldName("cond");
            const thenBody = stmt.childForFieldName("then");
            const elseBody = stmt.childForFieldName("else");
            const group: SSLDialogGroup = {
                kind: "group",
                condition: condNode?.text ?? "",
                ...(condNode ? { conditionRange: { start: condNode.startIndex, end: condNode.endIndex } } : {}),
                thenBlock: thenBody ? buildBlock(branchStmts(thenBody), fullText, counters) : [],
                ...(elseBody ? { elseBlock: buildBlock(branchStmts(elseBody), fullText, counters) } : {}),
            };
            items.push(group);
            continue;
        }
        const expr = stmt.type === SyntaxType.ExpressionStmt ? stmt.namedChildren[0] : undefined;
        if (expr && expr.type === SyntaxType.CallExpr && isDialogCallExpr(expr)) {
            // Reply -> line (replies[]); every other recognized dialog call (N/G/B Option + Low, N/G/B Message)
            // -> choice (options[], where the flat walk also puts messages).
            const fn = expr.childForFieldName("func")?.text;
            if (fn === "Reply") items.push({ kind: "line", replyIndex: counters.reply++ });
            else items.push({ kind: "choice", optionIndex: counters.opt++ });
            continue;
        }
        if (stmt.type === SyntaxType.CallStmt) {
            items.push({ kind: "transition", transitionIndex: counters.trans++ });
            continue;
        }
        // A preservable simple statement (assignment / side-effect call) the block keeps byte-exact.
        items.push({
            kind: "opaque",
            text: fullText.slice(stmt.startIndex, stmt.endIndex),
            textRange: { start: stmt.startIndex, end: stmt.endIndex },
        });
    }
    return items;
}

// A branch body's statement list: the named children of a `begin...end` block, or the single bare statement.
function branchStmts(branch: SyntaxNode): SyntaxNode[] {
    return branch.type === SyntaxType.Block ? branch.children.filter((c) => c.isNamed) : [branch];
}

// The splice point for a new option at the end of a branch block (begin...end): end of the last
// named statement + that statement's line indentation. Only called for block branches; bare
// single-statement branches carry no insertAnchor - adding to them would require begin/end synthesis,
// which is not supported this slice, so add is offered only for block branches. An empty block anchors
// just inside `begin`.
function branchInsertAnchor(body: SyntaxNode, fullText: string): { offset: number; indent: string } {
    const stmts = body.children.filter((c) => c.isNamed);
    const last = stmts.at(-1);
    if (!last) return { offset: body.startIndex + 1, indent: "        " }; // empty block: just inside `begin`
    const lineStart = fullText.lastIndexOf("\n", last.startIndex - 1) + 1;
    const indent = /^[ \t]*/.exec(fullText.slice(lineStart, last.startIndex))?.[0] ?? "        ";
    return { offset: last.endIndex, indent };
}

// Group a bundle-faithful procedure's body into ordered branches. The proc body is only top-level `if`s
// (Task 1 gate), so each yields an "if" branch (its then-body) and, when present, an "else" branch. Dialog
// calls are matched to the flat replies/options arrays by source order: both this walk and parseProcedure's
// walkTree are preorder, so the Nth Reply call -> replies[N], the Nth option/message call -> options[N].
// Non-dialog statements become opaque items (text + span) preserved on save.
function buildBranches(proc: SyntaxNode, fullText: string): SSLDialogBranch[] {
    const branches: SSLDialogBranch[] = [];
    let replyIdx = 0;
    let optIdx = 0;

    const collectBody = (branch: SSLDialogBranch, body: SyntaxNode): void => {
        const stmts = body.type === SyntaxType.Block ? body.children.filter((c) => c.isNamed) : [body];
        for (const stmt of stmts) {
            const expr = stmt.type === SyntaxType.ExpressionStmt ? stmt.namedChildren[0] : undefined;
            if (expr && expr.type === SyntaxType.CallExpr && isDialogCallExpr(expr)) {
                const fn = expr.childForFieldName("func")?.text;
                if (fn === "Reply") branch.replyIndices.push(replyIdx++);
                else branch.optionIndices.push(optIdx++);
            } else {
                branch.opaque.push({
                    text: fullText.slice(stmt.startIndex, stmt.endIndex),
                    textRange: { start: stmt.startIndex, end: stmt.endIndex },
                });
            }
        }
    };

    for (const stmt of proc.childrenForFieldName("body")) {
        // Bundle-faithful guarantees every top-level statement is an IfStmt.
        const condNode = stmt.childForFieldName("cond");
        const thenBody = stmt.childForFieldName("then");
        const ifBranch: SSLDialogBranch = {
            kind: "if",
            condition: condNode?.text,
            ...(condNode ? { conditionRange: { start: condNode.startIndex, end: condNode.endIndex } } : {}),
            stmtRange: { start: stmt.startIndex, end: stmt.endIndex },
            replyIndices: [],
            optionIndices: [],
            opaque: [],
        };
        if (thenBody) {
            collectBody(ifBranch, thenBody);
            if (thenBody.type === SyntaxType.Block) {
                ifBranch.insertAnchor = branchInsertAnchor(thenBody, fullText);
                // thenBody.endIndex is right after the then-block's closing `end`; this is where
                // ` else begin...end` is appended when adding a new else clause to this if.
                ifBranch.thenBlockEnd = thenBody.endIndex;
            }
        }
        branches.push(ifBranch);
        const elseBody = stmt.childForFieldName("else");
        if (elseBody) {
            const elseBranch: SSLDialogBranch = { kind: "else", replyIndices: [], optionIndices: [], opaque: [] };
            collectBody(elseBranch, elseBody);
            if (elseBody.type === SyntaxType.Block) elseBranch.insertAnchor = branchInsertAnchor(elseBody, fullText);
            // Locate the `else` keyword: first occurrence after the then-block end (or statement start
            // as a fallback when thenBody is absent, which cannot happen in valid SSL but is defensive).
            const elseKw = fullText.indexOf("else", thenBody ? thenBody.endIndex : stmt.startIndex);
            elseBranch.elseClauseRange = { start: elseKw, end: elseBody.endIndex };
            branches.push(elseBranch);
        }
    }
    return branches;
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
 * Walk up from a dialog call to the procedure body, conjoining EVERY enclosing `if` condition (not just
 * the nearest one). A doubly-nested option is gated by all its ancestors, so returning only the innermost
 * silently drops the outer gates and misrepresents the option (see memory `dialog-nested-flatten-bug-class`,
 * symptom 1). The parts are joined outermost-first with ` and `; an `else`-branch level is negated. This
 * feeds the flat projection (graph edge badge, inspector detail); the tree's structured render instead shows
 * each condition once at its own nesting level. For a single-level `if` (the faithful/bundle tiers) the result
 * is that one condition unchanged, so those tiers' round-trip is byte-identical.
 *
 * When `skip` is given, `if`s whose byte-span key is in it are omitted - used to scope an option's condition to
 * its own state by dropping the state-level gate (the enclosing `if`s the state's first Reply also sits under,
 * already shown as the state trigger), so that gate is not re-shown on every child option.
 */
function enclosingCondition(node: SyntaxNode, skip?: ReadonlySet<string>): string | undefined {
    // Track the child we ascend through so that at an `if` we can tell whether the call sits in the `then`
    // branch (runs on the condition) or the `else` branch (runs on its negation). Collect innermost-first.
    const parts: string[] = [];
    let prev: SyntaxNode = node;
    let cur: SyntaxNode | null = node.parent;
    while (cur) {
        if (cur.type === SyntaxType.IfStmt && !skip?.has(`${cur.startIndex}:${cur.endIndex}`)) {
            const cond = cur.childForFieldName("cond")?.text;
            if (cond !== undefined) {
                const elseBody = cur.childForFieldName("else");
                // Compare by byte span, not reference: web-tree-sitter returns fresh wrapper objects for the
                // same node, so `prev === elseBody` is never true. SSL negation is `not (...)` (not the C/D `!`),
                // and SSL conditions are already parenthesized (`if (X)`), so `not (X)` is well-formed.
                const inElse =
                    elseBody !== null && prev.startIndex === elseBody.startIndex && prev.endIndex === elseBody.endIndex;
                parts.push(inElse ? `not ${cond}` : cond);
            }
        }
        prev = cur;
        cur = cur.parent;
    }
    if (parts.length === 0) return undefined;
    // parts are innermost-first; present outermost-first so the composite gate reads top-down.
    parts.reverse();
    return parts.length === 1 ? parts[0] : parts.join(" and ");
}

// Byte-span keys of every enclosing `if` statement of `node`, up to the procedure body. Identifies the exact
// `if` nodes so a caller can subtract a state-level gate from an option's condition by node identity (robust
// against two different `if`s sharing the same condition text - see `enclosingCondition`'s `skip`).
function enclosingIfKeys(node: SyntaxNode): ReadonlySet<string> {
    const keys = new Set<string>();
    let cur: SyntaxNode | null = node.parent;
    while (cur) {
        if (cur.type === SyntaxType.IfStmt) keys.add(`${cur.startIndex}:${cur.endIndex}`);
        cur = cur.parent;
    }
    return keys;
}

// Spans of the nearest enclosing single-level `if` whose THEN-branch directly contains this call. Returns
// undefined when the call is not in a then-branch (e.g. an else branch - non-faithful anyway, not editable).
// condRange covers the `cond` field node (with its parentheses); ifRange the whole `if` statement; ifPure is
// true iff the then-branch holds this option ALONE (a single statement) - the only condition-editable shape,
// because editing a gate shared with a Reply, sibling option, or side-effect would re-time those too.
function enclosingIfSpans(
    node: SyntaxNode,
): { condRange: { start: number; end: number }; ifRange: { start: number; end: number }; ifPure: boolean } | undefined {
    let prev: SyntaxNode = node;
    let cur: SyntaxNode | null = node.parent;
    let inner:
        | { condRange: { start: number; end: number }; ifRange: { start: number; end: number }; ifPure: boolean }
        | undefined;
    while (cur) {
        if (cur.type === SyntaxType.IfStmt) {
            // A SECOND enclosing `if` above the innermost one: the call is multi-level nested. Its real gate is
            // the conjunction of both levels, which cannot round-trip to a single `if` wrapper, so it is NOT
            // condition-editable. Returning the inner span here (the old behavior) let a nested single-call `if`
            // slip through as editable - editing it rewrote only the inner condition, silently keeping the outer
            // gate (memory `dialog-nested-flatten-bug-class`, symptom 2). Bail to read-only instead.
            if (inner) return undefined;
            const condNode = cur.childForFieldName("cond");
            const thenBody = cur.childForFieldName("then");
            if (!condNode || !thenBody) return undefined;
            // Compare by byte span - web-tree-sitter returns fresh wrapper objects on each access
            const inThen = prev.startIndex === thenBody.startIndex && prev.endIndex === thenBody.endIndex;
            if (!inThen) return undefined; // else branch (or malformed) - not editable
            inner = {
                condRange: { start: condNode.startIndex, end: condNode.endIndex },
                ifRange: { start: cur.startIndex, end: cur.endIndex },
                ifPure: branchStatementCount(thenBody) === 1,
            };
            // Keep walking to detect an outer `if` (multi-level); return the inner span only if none is found.
        }
        prev = cur;
        cur = cur.parent;
    }
    return inner;
}

// Number of source statements directly in an if's then-branch. A condition is editable only when its `if`
// gates its option ALONE - the branch holds exactly ONE statement, that option - so editing the condition
// affects nothing else. A Reply line, a sibling option, or a side-effect call sharing the branch makes it >1
// (impure): editing the gate would silently re-time the other statements too. A begin...end block lists its
// statements as named children; a bare single-statement then-body IS the statement. Comments don't count.
function branchStatementCount(branch: SyntaxNode): number {
    if (branch.type === SyntaxType.Block) {
        return branch.namedChildren.filter((c) => c.type !== SyntaxType.Comment && c.type !== SyntaxType.LineComment)
            .length;
    }
    return 1;
}

function walkTree(node: SyntaxNode, callback: (_node: SyntaxNode) => void): void {
    callback(node);
    for (const child of node.children) {
        walkTree(child, callback);
    }
}
