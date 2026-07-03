/**
 * Dialog parser for Fallout SSL scripts using tree-sitter.
 * Extracts dialog structure (nodes, replies, options) for visualization.
 */

import type { Node as SyntaxNode } from "web-tree-sitter";
import { initParser, parseWithCache, isInitialized } from "../../shared/parsers/fallout-ssl";
import { SyntaxType } from "./fallout-ssl/syntax-type";
import type {
    SSLDialogBranch,
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
                        ? { condRange: ifSpans.condRange, ifRange: ifSpans.ifRange, ifSingleCall: ifSpans.ifSingleCall }
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
                    msgKind: classifyMsgId(arg0),
                    callRange: { start: node.startIndex, end: node.endIndex },
                    targetRange: { start: arg1.startIndex, end: arg1.endIndex },
                    stmtRange: statementRange(node),
                    ...(ifSpans
                        ? { condRange: ifSpans.condRange, ifRange: ifSpans.ifRange, ifSingleCall: ifSpans.ifSingleCall }
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
                    msgKind: classifyMsgId(arg0),
                    // A terminal message is an EXISTING statement: record its span so the editor can tell it
                    // from a newly-added option (which has no source range). Without this, a structural save
                    // re-serializes and duplicates it. No callRange/targetRange - a message has no target node.
                    stmtRange: statementRange(node),
                    ...(ifSpans
                        ? { condRange: ifSpans.condRange, ifRange: ifSpans.ifRange, ifSingleCall: ifSpans.ifSingleCall }
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
    return {
        name,
        line: proc.startPosition.row + 1,
        replies,
        options,
        callTargets,
        faithful,
        // Mutually exclusive with faithful: only claim nodes the plain-faithful gate rejects.
        ...(!faithful && isBundleFaithfulProcedure(proc)
            ? { bundleFaithful: true as const, branches: buildBranches(proc, fullText) }
            : {}),
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
    if (!last) return { offset: proc.startIndex, indent: "    " }; // empty body: refined by Tier 3
    const lineStart = fullText.lastIndexOf("\n", last.startIndex - 1) + 1;
    const indent = /^[ \t]*/.exec(fullText.slice(lineStart, last.startIndex))?.[0] ?? "    ";
    return { offset: last.endIndex, indent };
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

// Spans of the nearest enclosing single-level `if` whose THEN-branch directly contains this call. Returns
// undefined when the call is not in a then-branch (e.g. an else branch - non-faithful anyway, not editable).
// condRange covers the `cond` field node (with its parentheses); ifRange the whole `if` statement; ifSingleCall
// is true iff the then-branch contains exactly one dialog call/transition (the only condition-editable shape).
function enclosingIfSpans(
    node: SyntaxNode,
):
    | { condRange: { start: number; end: number }; ifRange: { start: number; end: number }; ifSingleCall: boolean }
    | undefined {
    let prev: SyntaxNode = node;
    let cur: SyntaxNode | null = node.parent;
    while (cur) {
        if (cur.type === SyntaxType.IfStmt) {
            const condNode = cur.childForFieldName("cond");
            const thenBody = cur.childForFieldName("then");
            if (!condNode || !thenBody) return undefined;
            // Compare by byte span - web-tree-sitter returns fresh wrapper objects on each access
            const inThen = prev.startIndex === thenBody.startIndex && prev.endIndex === thenBody.endIndex;
            if (!inThen) return undefined; // else branch (or malformed) - not editable
            return {
                condRange: { start: condNode.startIndex, end: condNode.endIndex },
                ifRange: { start: cur.startIndex, end: cur.endIndex },
                ifSingleCall: countDialogCallsInBranch(thenBody) === 1,
            };
        }
        prev = cur;
        cur = cur.parent;
    }
    return undefined;
}

// Count dialog-producing statements in an if's then-branch: recognized dialog call exprs
// (Reply/N*Option/.../N*Message) plus `call <target>;` transitions. Used only to decide single- vs
// multi-call; nested ifs make a procedure non-faithful, so they never reach a faithful editable branch.
function countDialogCallsInBranch(branch: SyntaxNode): number {
    let n = 0;
    walkTree(branch, (node) => {
        if (node.type === SyntaxType.CallExpr && isDialogCallExpr(node)) n++;
        if (node.type === SyntaxType.CallStmt) n++;
    });
    return n;
}

function walkTree(node: SyntaxNode, callback: (_node: SyntaxNode) => void): void {
    callback(node);
    for (const child of node.children) {
        walkTree(child, callback);
    }
}
