/**
 * TD SOURCE parser: parses raw `.td` TypeScript directly (no transpile/bundle) into the WeiDU D
 * `DDialogData` shape, with byte ranges into the `.td` SOURCE. A zero-arg `function stateNNN` is a dialog
 * state; its enclosing `if (...)` becomes the state entry trigger; `say(tra(N))` is an NPC line; a
 * `reply(tra(M))` then `goTo(t)`/`exit()`/`extern(f,s)` (statement OR chain form) is a player transition.
 *
 * Phase 1 (read-only view): states carry sayTexts, entry trigger, transitions, and a source range; blocks
 * are emitted for root grouping. Full block-kind write-back anchors land with TD editing (Phase 2+).
 */

import { Node, Project, SyntaxKind, type CallExpression, type FunctionDeclaration, type SourceFile } from "ts-morph";
import type {
    DDialogBlock,
    DDialogBlockKind,
    DDialogData,
    DDialogState,
    DDialogTarget,
    DDialogTransition,
} from "../../../shared/dialog-types";

const span = (n: Node): { start: number; end: number } => ({ start: n.getStart(), end: n.getEnd() });
const stripQuotes = (s: string): string => s.replaceAll(/^["'`]|["'`]$/g, "");

/** The method name of a call: `foo(...)` -> "foo"; `x.goTo(...)` -> "goTo". */
function methodName(call: CallExpression): string | undefined {
    const e = call.getExpression();
    if (e.getKind() === SyntaxKind.Identifier) return e.getText();
    if (Node.isPropertyAccessExpression(e)) return e.getName();
    return undefined;
}

/** Unwind a method chain (`reply(a).action(b).goTo(c)`) into its calls in SOURCE order (reply, action, goTo). */
function chainCalls(expr: Node): CallExpression[] {
    // Visit outer call (the chain terminator, e.g. goTo) first, then unwind inward; unshift so the
    // returned list is in SOURCE order (reply, action, goTo) without a mutating reverse.
    const calls: CallExpression[] = [];
    let cur: Node = expr;
    while (Node.isCallExpression(cur)) {
        calls.unshift(cur);
        const callee = cur.getExpression();
        if (Node.isPropertyAccessExpression(callee)) cur = callee.getExpression();
        else break;
    }
    return calls;
}

/** `tra(N)` -> "@N"; any other arg -> its source text; undefined for a missing arg. */
function traText(arg: Node | undefined): string | undefined {
    if (!arg) return undefined;
    if (Node.isCallExpression(arg) && methodName(arg) === "tra") {
        const inner = arg.getArguments()[0];
        return inner ? `@${inner.getText()}` : undefined;
    }
    return arg.getText();
}

function targetOf(method: string, call: CallExpression): DDialogTarget | undefined {
    const args = call.getArguments();
    if (method === "goTo") return args[0] ? { kind: "goto", label: args[0].getText() } : undefined;
    if (method === "exit") return { kind: "exit" };
    if (method === "extern" && args[0] && args[1]) {
        return { kind: "extern", file: stripQuotes(args[0].getText()), label: args[1].getText() };
    }
    return undefined;
}

function parseState(fn: FunctionDeclaration): DDialogState {
    const label = fn.getName() ?? "";
    const sayTexts: Array<{ text: string; range: { start: number; end: number } }> = [];
    const transitions: DDialogTransition[] = [];
    let pending: { replyText?: string; action?: string } = {};
    let pendingLine = 0;

    const flush = (target: DDialogTarget, targetRange?: { start: number; end: number }): void => {
        transitions.push({ line: pendingLine || 1, ...pending, target, ...(targetRange ? { targetRange } : {}) });
        pending = {};
        pendingLine = 0;
    };

    const applyCall = (call: CallExpression): void => {
        const m = methodName(call);
        if (m === undefined) return;
        const args = call.getArguments();
        if (m === "say") {
            const t = traText(args[0]);
            if (t !== undefined) sayTexts.push({ text: t, range: span(call) });
        } else if (m === "reply") {
            pending.replyText = traText(args[0]);
            pendingLine = call.getStartLineNumber();
        } else if (m === "action") {
            pending.action = stripQuotes(args[0]?.getText() ?? "");
        } else if (m === "goTo" || m === "exit" || m === "extern") {
            const target = targetOf(m, call);
            if (target) {
                if (!pendingLine) pendingLine = call.getStartLineNumber();
                // The target identifier arg: goTo(<id>) / extern(file, <id>) - its span drives token-splice retarget.
                const idArg = m === "goTo" ? args[0] : m === "extern" ? args[1] : undefined;
                flush(target, idArg ? span(idArg) : undefined);
            }
        }
    };

    const walk = (stmts: Node[]): void => {
        for (const stmt of stmts) {
            if (Node.isIfStatement(stmt)) {
                const thenStmt = stmt.getThenStatement();
                walk(Node.isBlock(thenStmt) ? thenStmt.getStatements() : [thenStmt]);
                continue;
            }
            if (Node.isExpressionStatement(stmt)) {
                for (const c of chainCalls(stmt.getExpression())) applyCall(c);
            }
        }
    };
    walk(fn.getStatements());

    // Entry trigger: the nearest enclosing `if (...)` wrapping the state function (the state-gate pattern).
    const ifStmt = fn.getFirstAncestorByKind(SyntaxKind.IfStatement);
    const trigger = ifStmt ? ifStmt.getExpression().getText() : undefined;

    return {
        label,
        line: fn.getStartLineNumber(),
        sayText: sayTexts[0]?.text ?? "",
        ...(sayTexts.length > 0 ? { sayTexts } : {}),
        ...(trigger !== undefined ? { trigger } : {}),
        transitions,
        range: span(fn),
    };
}

const BLOCK_KINDS: Record<string, DDialogBlockKind> = {
    begin: "begin",
    append: "append",
    appendEarly: "append",
    chain: "chain",
    interject: "interject",
    interjectBottom: "interject",
    extendTop: "extend",
    extendBottom: "extend",
    replaceState: "replace",
    replaceSay: "modify",
};

function resolveFile(arg: Node | undefined, consts: Map<string, string>): string {
    if (!arg) return "dialog";
    if (Node.isStringLiteral(arg)) return arg.getLiteralText();
    if (arg.getKind() === SyntaxKind.Identifier) return consts.get(arg.getText()) ?? arg.getText();
    return stripQuotes(arg.getText());
}

function parseBlocks(sf: SourceFile): DDialogBlock[] {
    const consts = new Map<string, string>();
    for (const v of sf.getVariableDeclarations()) {
        const init = v.getInitializer();
        if (init && Node.isStringLiteral(init)) consts.set(v.getName(), init.getLiteralText());
    }
    const blocks: DDialogBlock[] = [];
    sf.forEachDescendant((node) => {
        if (!Node.isCallExpression(node)) return;
        const m = methodName(node);
        if (m === undefined) return;
        const kind = BLOCK_KINDS[m];
        if (kind === undefined) return;
        blocks.push({ kind, file: resolveFile(node.getArguments()[0], consts), line: node.getStartLineNumber() });
    });
    return blocks;
}

/**
 * Parse TD source into WeiDU D DialogData with ranges into the source. Phase 1 (read-only view): every
 * zero-parameter top-level `function` is treated as a state (param'd functions are inlined helpers). Full
 * state/block cross-linking and write-back anchors land with TD editing (Phase 2+).
 */
export function parseTDSource(text: string): DDialogData {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile("dialog.td.ts", text);
    const states: DDialogState[] = [];
    // States can be nested inside their entry `if` block, so walk all function declarations (not just
    // top-level). Skip bodiless `declare function` ambient decls (TS forward decls) and param'd functions
    // (inlined helpers, not states).
    for (const fn of sf.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)) {
        if (fn.getName() === undefined) continue;
        if (fn.getBody() === undefined) continue;
        if (fn.getParameters().length > 0) continue;
        states.push(parseState(fn));
    }
    return { blocks: parseBlocks(sf), states };
}
