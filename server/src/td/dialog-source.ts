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
import { conlog } from "../logger";
import type {
    DDialogBlock,
    DDialogBlockKind,
    DDialogData,
    DDialogState,
    DDialogTarget,
    DDialogTransition,
    TDStateRef,
    TDWiring,
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

type Range = { start: number; end: number };

/** The enclosing statement span of a call (incl. the trailing `;`), for the reply/goTo statement group. */
function stmtSpanOf(call: CallExpression): Range {
    const stmt = call.getFirstAncestorByKind(SyntaxKind.ExpressionStatement);
    return stmt ? span(stmt) : span(call);
}

/**
 * Conjoin EVERY `if (...)` wrapping the state function into one entry trigger, outermost-first, joined with
 * ` and `, an `else`-branch level negated `not ` - mirroring the SSL (`dialog.ts` `enclosingCondition`) and TSSL
 * (`tssl/dialog-source.ts` `enclosingConditionTSSL`) parsers. Returning only the nearest ancestor `if` silently
 * drops the outer gates (dialog-nested-flatten-bug-class). Returns undefined for an unwrapped state function.
 */
function enclosingTrigger(fn: FunctionDeclaration): string | undefined {
    const parts: string[] = [];
    let prev: Node = fn;
    let cur: Node | undefined = fn.getParent();
    while (cur && !Node.isSourceFile(cur)) {
        if (Node.isIfStatement(cur)) {
            const cond = cur.getExpression().getText();
            const elseStmt = cur.getElseStatement();
            // The function sits in the `else` branch (runs on the negation) iff we ascended through the else node.
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
    parts.reverse(); // innermost-first -> outermost-first so the composite gate reads top-down
    return parts.length === 1 ? parts[0]! : parts.join(" and ");
}

function parseState(fn: FunctionDeclaration): DDialogState {
    const label = fn.getName() ?? "";
    const sayTexts: Array<{ text: string; range: Range }> = [];
    const transitions: DDialogTransition[] = [];
    // `replyStart` is the start offset of the transition's first statement (the `reply(...)`), so the whole
    // `reply(...); [action(...);] goTo(...);` group can be spliced as one unit on remove.
    let pending: { replyText?: string; action?: string; replyStart?: number } = {};
    let pendingLine = 0;

    const flush = (target: DDialogTarget, targetRange: Range | undefined, targetCall: CallExpression): void => {
        const { replyStart, ...rest } = pending;
        const targetStmt = stmtSpanOf(targetCall);
        const range: Range = { start: replyStart ?? targetStmt.start, end: targetStmt.end };
        // The isolable target-producing call span, for an exit()/extern() flip. A standalone (identifier-callee)
        // call IS its own span. A chained `reply(m).goTo(t)` call node spans the WHOLE chain, but the target call
        // is just the trailing `.goTo(t)` - so span from its method-name token (excluding the leading `.`) to the
        // call end, which a flip replaces with `exit()` to yield `reply(m).exit()`.
        const callee = targetCall.getExpression();
        const targetCallRange =
            callee.getKind() === SyntaxKind.Identifier
                ? span(targetCall)
                : Node.isPropertyAccessExpression(callee)
                  ? { start: callee.getNameNode().getStart(), end: targetCall.getEnd() }
                  : undefined;
        transitions.push({
            line: pendingLine || 1,
            ...rest,
            target,
            ...(targetRange ? { targetRange } : {}),
            range,
            ...(targetCallRange ? { targetCallRange } : {}),
        });
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
            if (pending.replyStart === undefined) pending.replyStart = stmtSpanOf(call).start;
            pendingLine = call.getStartLineNumber();
        } else if (m === "action") {
            pending.action = stripQuotes(args[0]?.getText() ?? "");
        } else if (m === "goTo" || m === "exit" || m === "extern") {
            const target = targetOf(m, call);
            if (target) {
                if (!pendingLine) pendingLine = call.getStartLineNumber();
                // The target identifier arg: goTo(<id>) / extern(file, <id>) - its span drives token-splice retarget.
                const idArg = m === "goTo" ? args[0] : m === "extern" ? args[1] : undefined;
                flush(target, idArg ? span(idArg) : undefined, call);
            }
        }
    };

    // An `if` INSIDE the state body means conditional transitions the flat list can't round-trip: the gate is
    // dropped and an `else`'s (negated) transitions vanish on save. Flag the state unfaithful (the editability
    // gate then renders it read-only) rather than silently mis-serialize it. Still walk BOTH branches so the
    // read-only view shows every transition instead of hiding the else.
    let hasBodyConditional = false;
    const walk = (stmts: Node[]): void => {
        for (const stmt of stmts) {
            if (Node.isIfStatement(stmt)) {
                hasBodyConditional = true;
                const thenStmt = stmt.getThenStatement();
                walk(Node.isBlock(thenStmt) ? thenStmt.getStatements() : [thenStmt]);
                const elseStmt = stmt.getElseStatement();
                if (elseStmt) walk(Node.isBlock(elseStmt) ? elseStmt.getStatements() : [elseStmt]);
                continue;
            }
            if (Node.isExpressionStatement(stmt)) {
                for (const c of chainCalls(stmt.getExpression())) applyCall(c);
            }
        }
    };
    walk(fn.getStatements());

    // Entry trigger: conjoin EVERY `if (...)` wrapping the state function, not just the nearest - returning only
    // the innermost silently drops the outer gates (dialog-nested-flatten-bug-class). Mirrors the SSL/TSSL
    // `enclosingCondition` parsers: outermost-first, joined with ` and `, an `else`-branch level negated `not `.
    const trigger = enclosingTrigger(fn);
    const nameNode = fn.getNameNode();

    // Enclosing-if delete span: when the state function is the SOLE meaningful statement of an `if` then-block
    // (and the `if` has no `else`), the `if` exists only to conditionally define this state - so a delete must
    // remove the whole gate, not leave `if (...) {}` behind. Only a directly-wrapping block-bodied `if` qualifies.
    const parentBlock = fn.getParentIfKind(SyntaxKind.Block);
    const enclosingIf = parentBlock?.getParentIfKind(SyntaxKind.IfStatement);
    let enclosingIfRange: Range | undefined;
    if (enclosingIf && enclosingIf.getThenStatement() === parentBlock && !enclosingIf.getElseStatement()) {
        const meaningful = parentBlock!.getStatements().filter((s) => !Node.isEmptyStatement(s));
        if (meaningful.length === 1 && meaningful[0] === fn) enclosingIfRange = span(enclosingIf);
    }

    return {
        label,
        line: fn.getStartLineNumber(),
        sayText: sayTexts[0]?.text ?? "",
        ...(sayTexts.length > 0 ? { sayTexts } : {}),
        ...(trigger !== undefined ? { trigger } : {}),
        transitions,
        range: span(fn),
        ...(nameNode ? { nameRange: span(nameNode) } : {}),
        ...(enclosingIfRange ? { enclosingIfRange } : {}),
        ...(hasBodyConditional ? { faithful: false } : {}),
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

/** Functions that carry a state LIST (their args after the file are state function identifiers). */
const LIST_FNS: ReadonlySet<string> = new Set(["append", "appendEarly", "begin"]);

/**
 * Extract the wiring a structural edit needs beyond per-state spans: every out-of-body reference to a state
 * (state-list elements in append/begin/appendEarly, and entry-block `goTo` targets), plus the insertion anchors
 * for a new state's function declaration and its state-list entry. `stateNames` scopes the collection to real
 * state functions so an unrelated identifier is never treated as a state ref. The PRIMARY state list (the first
 * append/begin found) owns the insertion anchors - a new state joins it.
 */
function parseWiring(sf: SourceFile, stateNames: ReadonlySet<string>): TDWiring | undefined {
    const refs: TDStateRef[] = [];
    let listInsert: TDWiring["listInsert"];
    let newFnAnchor: number | undefined;
    let primarySeen = false;

    sf.forEachDescendant((node) => {
        if (!Node.isCallExpression(node)) return;
        const m = methodName(node);
        if (m === undefined) return;

        // An entry/extend-block goTo target is a `goTo(<id>)` with no enclosing state function (it lives in the
        // block's arrow body). A goTo inside a state function is a model choice, handled by the retarget path.
        if (m === "goTo") {
            const insideState = node.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration) !== undefined;
            const arg = node.getArguments()[0];
            if (!insideState && arg && arg.getKind() === SyntaxKind.Identifier && stateNames.has(arg.getText())) {
                refs.push({ name: arg.getText(), range: span(arg), kind: "entry", callRange: span(node) });
            }
            return;
        }

        if (!LIST_FNS.has(m)) return;
        const args = node.getArguments();
        const second = args[1];
        const elements: Node[] = [];
        let closeOffset: number;
        if (second && Node.isArrayLiteralExpression(second)) {
            for (const el of second.getElements()) if (el.getKind() === SyntaxKind.Identifier) elements.push(el);
            closeOffset = second.getEnd() - 1; // just before `]`
        } else {
            for (let i = 1; i < args.length; i++) {
                const a = args[i]!;
                if (a.getKind() === SyntaxKind.Identifier) elements.push(a);
            }
            closeOffset = node.getEnd() - 1; // just before `)`
        }
        for (const el of elements) {
            if (stateNames.has(el.getText())) refs.push({ name: el.getText(), range: span(el), kind: "list" });
        }
        if (!primarySeen) {
            primarySeen = true;
            // Anchor a new id right AFTER the last existing element, not just before the close token. A multi-line
            // list emitted by the formatter carries a trailing comma after its last element, so inserting `, <id>`
            // before the `)`/`]` would land it AFTER that comma and produce a double comma - an empty call
            // argument (a hard syntax error) or an array hole. Inserting after the element leaves any trailing
            // comma following the new id, which stays well-formed. Empty list: no anchor element, insert at close.
            const lastEl = elements.at(-1);
            listInsert = lastEl ? { offset: lastEl.getEnd(), separator: ", " } : { offset: closeOffset, separator: "" };
            // Anchor a new function before the whole primary wiring statement (an `append(...)` statement or an
            // `export default begin(...)`), so it lands among the other state functions.
            let anchor: Node = node;
            let p: Node | undefined = node.getParent();
            while (p && !Node.isSourceFile(p)) {
                anchor = p;
                p = p.getParent();
            }
            newFnAnchor = anchor.getStart();
        }
    });
    if (refs.length === 0 && listInsert === undefined) return undefined;
    return {
        refs,
        ...(listInsert ? { listInsert } : {}),
        ...(newFnAnchor !== undefined ? { newFnAnchor } : {}),
    };
}

/**
 * Parse TD source into WeiDU D DialogData with ranges into the source. Every zero-parameter top-level
 * `function` is a state (param'd functions are inlined helpers); per-state and per-transition byte ranges plus
 * the state-list wiring (`tdWiring`) drive surgical write-back.
 */
export function parseTDSource(text: string): DDialogData {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile("dialog.td.ts", text);
    // The TS parser never throws on malformed input, but its error recovery is not local: an unclosed brace
    // can swallow every following function into one misnested body, silently re-parenting states and shifting
    // the splice anchors the write-back relies on. Unlike tree-sitter's localized ERROR nodes (which the
    // .d/.ssl bridges tolerate), anchors from an errored TS parse are untrustworthy - so degrade to the empty
    // model like the siblings' no-tree guard, logged at warn so the degrade is diagnosable.
    const syntaxErrors = project.getProgram().getSyntacticDiagnostics(sf);
    if (syntaxErrors.length > 0) {
        conlog(`parseTDSource: ${syntaxErrors.length} syntax error(s) in TD source; returning empty dialog`, "warn");
        return { blocks: [], states: [] };
    }
    const states: DDialogState[] = [];
    // Ambient forward declarations (`declare function <name>(): void;`) keyed by name, so a node delete can
    // splice out the matching declaration and leave no dangling forward decl (mirrors the SSL forward-decl cleanup).
    const declares = new Map<string, Range>();
    // States can be nested inside their entry `if` block, so walk all function declarations (not just
    // top-level). A bodiless zero-arg function is a `declare function` forward decl (recorded above, not a state);
    // param'd functions are inlined helpers, not states.
    for (const fn of sf.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)) {
        const nm = fn.getName();
        if (nm === undefined) continue;
        if (fn.getBody() === undefined) {
            if (fn.getParameters().length === 0) declares.set(nm, span(fn));
            continue;
        }
        if (fn.getParameters().length > 0) continue;
        states.push(parseState(fn));
    }
    for (const s of states) {
        const decl = declares.get(s.label);
        if (decl) s.forwardDeclStmtRange = decl;
    }
    const stateNames = new Set(states.map((s) => s.label));
    const tdWiring = parseWiring(sf, stateNames);
    return { blocks: parseBlocks(sf), states, ...(tdWiring ? { tdWiring } : {}) };
}
