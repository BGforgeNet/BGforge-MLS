/**
 * TD transition call processing - handles individual transition-modifying
 * function calls (reply, goTo, action, journal, etc.), the extend block
 * statement processor, and transition field helpers.
 *
 * Extracted from state-transitions.ts. Has no dependency on state-transitions.ts
 * to avoid circular imports - callers provide any inlining behaviour via callback.
 */

import { type CallExpression, type Statement, Node, SyntaxKind } from "ts-morph";
import { TDTransitionType, type TDTransition } from "./types";
import type { Scope } from "../../common/compile-time-eval";
import {
    actionsOf,
    blockScope,
    getCallArg,
    getCallArgs,
    integerOf,
    isDeclaration,
    nameOf,
    stateLabelOf,
    unrollLoop,
    validateArgs,
} from "./parse-helpers";
import { getBlockStatements } from "../../common/transpiler-utils";
import { TranspileError } from "../../common/transpile-error";
import { textOf, transitionTriggerOf } from "./expression-eval";
import { isChainExpression, parseTransitionChain } from "./chain-parsing";
import { lineNumberOfNode } from "../../common/line-index";

/**
 * Process a transition-modifying call (reply, goTo, action, journal, etc.)
 * Works with state, single transition, or extend context.
 *
 * Context interface:
 *   - getLastTransition(): returns the last transition or undefined
 *   - addTransition(trans): adds a new transition
 *
 * Returns true if the call was handled, false otherwise.
 */
export function processTransitionCall(
    funcName: string,
    args: Node[],
    expr: CallExpression,
    context: {
        getLastTransition(): TDTransition | undefined;
        addTransition(trans: TDTransition): void;
    },
    scope: Scope,
): boolean {
    const lineNumber = lineNumberOfNode(expr);

    switch (funcName) {
        case "reply":
            validateArgs("reply", args, 1, lineNumber);
            context.addTransition({
                reply: textOf(getCallArg(args, 0, expr), scope),
                next: { type: TDTransitionType.Exit },
            });
            break;

        case "goTo": {
            validateArgs("goTo", args, 1, lineNumber);
            const target = stateLabelOf(getCallArg(args, 0, expr), scope);
            const lastTrans = context.getLastTransition();
            if (lastTrans) {
                lastTrans.next = { type: TDTransitionType.Goto, target };
            } else {
                context.addTransition({ next: { type: TDTransitionType.Goto, target } });
            }
            break;
        }

        case "exit": {
            const lastTrans = context.getLastTransition();
            if (lastTrans) {
                lastTrans.next = { type: TDTransitionType.Exit };
            } else {
                context.addTransition({ next: { type: TDTransitionType.Exit } });
            }
            break;
        }

        case "action": {
            validateArgs("action", args, 1, lineNumber);
            const actionStr = actionsOf(getCallArgs(args, expr), scope);
            const lastTrans = context.getLastTransition();
            if (lastTrans) {
                lastTrans.action = actionStr;
            } else {
                context.addTransition({ action: actionStr, next: { type: TDTransitionType.Exit } });
            }
            break;
        }

        case "journal":
            setTransitionTextField(context, "journal", args, expr, funcName, scope);
            break;

        case "solvedJournal":
            setTransitionTextField(context, "solvedJournal", args, expr, funcName, scope);
            break;

        case "unsolvedJournal":
            setTransitionTextField(context, "unsolvedJournal", args, expr, funcName, scope);
            break;

        case "flags": {
            validateArgs("flags", args, 1, lineNumber);
            const lastTrans = context.getLastTransition();
            if (!lastTrans) {
                throw new TranspileError(`flags() must come after a transition`, { line: lineNumber });
            }
            lastTrans.flags = integerOf(getCallArg(args, 0, expr), scope, "a transition's flags");
            break;
        }

        case "extern": {
            validateArgs("extern", args, 2, lineNumber);
            const externNext: TDTransition["next"] = {
                type: TDTransitionType.Extern,
                filename: nameOf(getCallArg(args, 0, expr), scope, "a dialog file name"),
                target: stateLabelOf(getCallArg(args, 1, expr), scope),
            };
            const lastTrans = context.getLastTransition();
            if (lastTrans) {
                lastTrans.next = externNext;
            } else {
                context.addTransition({ next: externNext });
            }
            break;
        }

        default:
            return false; // Not handled
    }

    return true; // Handled
}

/**
 * Set a text field (journal/solvedJournal/unsolvedJournal) on last transition.
 */
function setTransitionTextField(
    context: { getLastTransition(): TDTransition | undefined },
    field: "journal" | "solvedJournal" | "unsolvedJournal",
    args: Node[],
    callExpr: CallExpression,
    funcName: string,
    scope: Scope,
): void {
    const lineNumber = lineNumberOfNode(callExpr);
    validateArgs(funcName, args, 1, lineNumber);
    const lastTrans = context.getLastTransition();
    if (!lastTrans) {
        throw new TranspileError(`${funcName}() must come after a transition`, { line: lineNumber });
    }
    lastTrans[field] = textOf(getCallArg(args, 0, callExpr), scope);
}

/**
 * Merge transition fields from source into target, preserving target's trigger.
 * Used when merging a chain or inlined transition into an existing one
 * that already has its trigger set from the enclosing if block.
 *
 * Note: mutates target in place. This is part of the IR builder pattern used
 * throughout processTransitionStatement/processStateStatement - transitions are
 * created as skeletons and progressively filled. The mutation is contained
 * within a single parse pass and transitions are never shared or read concurrently.
 */
function mergeTransitionFields(target: TDTransition, source: TDTransition): void {
    target.reply = source.reply;
    target.action = source.action;
    target.next = source.next;
    target.journal = source.journal;
    target.solvedJournal = source.solvedJournal;
    target.unsolvedJournal = source.unsolvedJournal;
    if (source.flags !== undefined) target.flags = source.flags;
}

/**
 * `outer` and `inner` as one trigger: D trigger lists AND by juxtaposition, so the two concatenate.
 * Undefined stands for no trigger.
 */
export function conjoinTriggers(outer: string | undefined, inner: string | undefined): string | undefined {
    if (outer === undefined) return inner;
    return inner === undefined ? outer : `${outer} ${inner}`;
}

/**
 * Whether an if body adds whole transitions - method chains, and calls `isWhole` accepts - rather than filling
 * in the one transition the body stands for (statement-form `reply()`, `action()`, `goTo()`).
 */
export function addsWholeTransitions(
    statements: readonly Statement[],
    isWhole: (call: CallExpression) => boolean,
): boolean {
    const effective = statements.filter((s) => !isDeclaration(s));
    return (
        effective.length > 0 &&
        effective.every((s) => {
            if (Node.isIfStatement(s) || Node.isForStatement(s) || Node.isForOfStatement(s) || Node.isBlock(s)) {
                return true;
            }
            if (!Node.isExpressionStatement(s)) return false;
            const expr = s.getExpression();
            return isChainExpression(expr) || (Node.isCallExpression(expr) && isWhole(expr));
        })
    );
}

/**
 * Process a statement that fills in transition details.
 *
 * The optional `onInline` callback handles user-function inlining when the
 * statement contains a call to a user-defined function. It receives the call
 * expression and function name, performs inlining, and returns any transitions
 * added as a result. This avoids a circular import between transition-calls.ts
 * and state-transitions.ts.
 */
export function processTransitionStatement(
    stmt: Statement,
    trans: TDTransition,
    scope: Scope,
    onInline?: (expr: CallExpression) => TDTransition[] | undefined,
): void {
    if (isDeclaration(stmt)) return;
    if (!stmt.isKind(SyntaxKind.ExpressionStatement)) {
        throw TranspileError.fromNode(stmt, `${stmt.getKindName()} is not supported in a transition block`);
    }
    const expr = stmt.getExpression();

    // Check for chain expression inside if block:
    // if (cond) { reply(x).goTo(y) }
    if (isChainExpression(expr)) {
        mergeTransitionFields(trans, parseTransitionChain(expr as CallExpression, scope));
        return;
    }

    if (!Node.isCallExpression(expr)) {
        throw TranspileError.fromNode(stmt, `${expr.getKindName()} is not supported as a transition statement`);
    }
    const funcName = expr.getExpression().getText();
    const args = expr.getArguments();

    // Special handling for reply() in single transition context
    if (funcName === "reply") {
        validateArgs("reply", args, 1, lineNumberOfNode(expr));
        trans.reply = textOf(getCallArg(args, 0, expr), scope);
        return;
    }

    // Create context wrapper for single transition.
    // addTransition should never be called here - if blocks already have
    // their transition created by processIfTransition.
    const context = {
        getLastTransition: () => trans,
        addTransition: () => {
            throw TranspileError.fromNode(expr, `Unexpected addTransition() in single-transition context`);
        },
    };
    if (processTransitionCall(funcName, args, expr, context, scope)) return;

    // A helper inlined here fills in this block's one transition, so it may add only one.
    const inlined = onInline?.(expr);
    if (inlined === undefined) {
        throw TranspileError.fromNode(expr, `'${funcName}()' is not a TD transition statement`);
    }
    const [only] = inlined;
    if (only === undefined || inlined.length > 1) {
        throw TranspileError.fromNode(
            expr,
            `'${funcName}()' adds ${inlined.length} transitions to the one this block builds; ` +
                "call it on its own in the if body, or build that transition in the helper",
        );
    }
    mergeTransitionFields(trans, only);
}

/**
 * Process statements in extend block to build transitions.
 * Similar to processStateStatement but builds transitions directly.
 */
export function processExtendStatements(statements: Statement[], transitions: TDTransition[], scope: Scope): void {
    for (const stmt of statements) {
        if (isDeclaration(stmt)) continue;
        if (stmt.isKind(SyntaxKind.IfStatement)) {
            // if (trigger) { ... } - transition with trigger
            const ifStmt = stmt;
            if (ifStmt.getElseStatement() !== undefined) {
                throw TranspileError.fromNode(ifStmt, "else is not supported in an extend block");
            }
            const trigger = transitionTriggerOf(ifStmt.getExpression(), scope);
            if (trigger === false) continue;
            const thenStmts = getBlockStatements(ifStmt.getThenStatement());
            const thenScope = blockScope(scope, thenStmts);
            const own = trigger === true ? undefined : trigger;

            // Method chains each add a transition the trigger guards.
            if (addsWholeTransitions(thenStmts, () => false)) {
                const added: TDTransition[] = [];
                processExtendStatements(thenStmts, added, thenScope);
                for (const trans of added) trans.trigger = conjoinTriggers(own, trans.trigger);
                transitions.push(...added);
                continue;
            }

            // Multi-statement then block or non-chain expression
            const trans: TDTransition = {
                trigger: own,
                next: { type: TDTransitionType.Exit },
            };

            for (const s of thenStmts) {
                processTransitionStatement(s, trans, thenScope);
            }

            transitions.push(trans);
        } else if (stmt.isKind(SyntaxKind.ExpressionStatement)) {
            const expr = stmt.getExpression();

            // Check for method-chained transition
            if (isChainExpression(expr)) {
                transitions.push(parseTransitionChain(expr as CallExpression, scope));
                continue;
            }

            // Expression statement - could be reply(), goTo(), action(), etc.
            if (!Node.isCallExpression(expr)) {
                throw TranspileError.fromNode(stmt, `${expr.getKindName()} is not supported in an extend block`);
            }
            const funcName = expr.getExpression().getText();

            // Create context for transitions array
            const context = {
                getLastTransition: () => transitions[transitions.length - 1],
                addTransition: (trans: TDTransition) => transitions.push(trans),
            };

            if (!processTransitionCall(funcName, expr.getArguments(), expr, context, scope)) {
                throw TranspileError.fromNode(expr, `'${funcName}()' is not a TD transition statement`);
            }
        } else if (stmt.isKind(SyntaxKind.ForOfStatement) || stmt.isKind(SyntaxKind.ForStatement)) {
            unrollLoop(stmt, scope, (body, iteration) => processExtendStatements(body, transitions, iteration));
        } else if (stmt.isKind(SyntaxKind.Block)) {
            processExtendStatements(stmt.getStatements(), transitions, blockScope(scope, stmt.getStatements()));
        } else {
            throw TranspileError.fromNode(stmt, `${stmt.getKindName()} is not supported in an extend block`);
        }
    }
}
