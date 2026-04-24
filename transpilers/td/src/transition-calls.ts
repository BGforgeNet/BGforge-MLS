/**
 * TD transition call processing - handles individual transition-modifying
 * function calls (reply, goTo, action, journal, etc.), the extend block
 * statement processor, and transition field helpers.
 *
 * Extracted from state-transitions.ts. Has no dependency on state-transitions.ts
 * to avoid circular imports — callers provide any inlining behaviour via callback.
 */

import {
    CallExpression,
    Expression,
    ForOfStatement,
    ForStatement,
    IfStatement,
    Node,
    Statement,
    SyntaxKind,
} from "ts-morph";
import { TDTransitionType, type TDTransition } from "./types";
import * as utils from "../../common/transpiler-utils";
import type { VarsContext } from "../../common/transpiler-utils";
import { resolveStringExpr, expressionToActionString, validateArgs, parseRequiredNumber } from "./parse-helpers";
import { TranspileError } from "../../common/transpile-error";
import { expressionToTrigger, expressionToText } from "./expression-eval";
import { isChainExpression, parseTransitionChain } from "./chain-parsing";
import { unrollForOf, unrollFor } from "./inline-and-unroll";

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
    vars: VarsContext,
): boolean {
    const lineNumber = expr.getStartLineNumber();

    switch (funcName) {
        case "reply":
            validateArgs("reply", args, 1, lineNumber);
            context.addTransition({
                reply: expressionToText(args[0] as Expression, vars),
                next: { type: TDTransitionType.Exit },
            });
            break;

        case "goTo": {
            validateArgs("goTo", args, 1, lineNumber);
            const target = resolveStringExpr(args[0] as Expression, vars);
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
            const actionStr = args.map((a) => expressionToActionString(a as Expression, vars)).join(" ");
            const lastTrans = context.getLastTransition();
            if (lastTrans) {
                lastTrans.action = actionStr;
            } else {
                context.addTransition({ action: actionStr, next: { type: TDTransitionType.Exit } });
            }
            break;
        }

        case "journal":
            setTransitionTextField(context, "journal", args, lineNumber, funcName, vars);
            break;

        case "solvedJournal":
            setTransitionTextField(context, "solvedJournal", args, lineNumber, funcName, vars);
            break;

        case "unsolvedJournal":
            setTransitionTextField(context, "unsolvedJournal", args, lineNumber, funcName, vars);
            break;

        case "flags": {
            validateArgs("flags", args, 1, lineNumber);
            const lastTrans = context.getLastTransition();
            if (!lastTrans) {
                throw new TranspileError(`flags() must come after a transition`, { line: lineNumber });
            }
            lastTrans.flags = parseRequiredNumber(args[0]!, "flags", lineNumber);
            break;
        }

        case "extern": {
            validateArgs("extern", args, 2, lineNumber);
            const externNext: TDTransition["next"] = {
                type: TDTransitionType.Extern,
                filename: utils.stripQuotes(args[0]!.getText()), // Guaranteed by validateArgs
                target: utils.stripQuotes(args[1]!.getText()), // Guaranteed by validateArgs
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
    lineNumber: number,
    funcName: string,
    vars: VarsContext,
): void {
    validateArgs(funcName, args, 1, lineNumber);
    const lastTrans = context.getLastTransition();
    if (!lastTrans) {
        throw new TranspileError(`${funcName}() must come after a transition`, { line: lineNumber });
    }
    lastTrans[field] = expressionToText(args[0] as Expression, vars);
}

/**
 * Merge transition fields from source into target, preserving target's trigger.
 * Used when merging a chain or inlined transition into an existing one
 * that already has its trigger set from the enclosing if block.
 *
 * Note: mutates target in place. This is part of the IR builder pattern used
 * throughout processTransitionStatement/processStateStatement — transitions are
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
    vars: VarsContext,
    onInline?: (expr: CallExpression, funcName: string) => TDTransition[],
): void {
    if (stmt.isKind(SyntaxKind.ExpressionStatement)) {
        const expr = stmt.getExpression();

        // Check for chain expression inside if block:
        // if (cond) { reply(x).goTo(y) }
        if (isChainExpression(expr)) {
            const chainTrans = parseTransitionChain(expr as CallExpression, vars);
            mergeTransitionFields(trans, chainTrans);
            return;
        }

        if (Node.isCallExpression(expr)) {
            const funcName = expr.getExpression().getText();
            const args = expr.getArguments();

            // Special handling for reply() in single transition context
            if (funcName === "reply") {
                validateArgs("reply", args, 1, expr.getStartLineNumber());
                trans.reply = expressionToText(args[0] as Expression, vars);
                return;
            }

            // Create context wrapper for single transition.
            // addTransition should never be called here — if blocks already have
            // their transition created by processIfTransition.
            const context = {
                getLastTransition: () => trans,
                addTransition: () => {
                    throw TranspileError.fromNode(expr, `Unexpected addTransition() in single-transition context`);
                },
            };

            const handled = processTransitionCall(funcName, args, expr, context, vars);

            // If not a transition call, try user function inlining via callback.
            // The inlined body adds transitions; we merge the first into the
            // existing transition (preserving trigger) and discard the rest
            // (state-transitions.ts already spliced them onto state.transitions).
            if (!handled && onInline) {
                const inlined = onInline(expr as CallExpression, funcName);
                if (inlined.length > 0) {
                    mergeTransitionFields(trans, inlined[0]!);
                }
            }
        }
    }
}

/**
 * Process statements in extend block to build transitions.
 * Similar to processStateStatement but builds transitions directly.
 */
export function processExtendStatements(statements: Statement[], transitions: TDTransition[], vars: VarsContext): void {
    for (const stmt of statements) {
        if (stmt.isKind(SyntaxKind.IfStatement)) {
            // if (trigger) { ... } - transition with trigger
            const ifStmt = stmt as IfStatement;
            const trigger = expressionToTrigger(ifStmt.getExpression(), vars);
            const thenStmts = utils.getBlockStatements(ifStmt.getThenStatement());

            // Check if the then-block has a single chain expression
            if (thenStmts.length === 1 && thenStmts[0]?.isKind(SyntaxKind.ExpressionStatement)) {
                const innerExpr = thenStmts[0].getExpression();
                if (isChainExpression(innerExpr)) {
                    const trans = parseTransitionChain(innerExpr as CallExpression, vars);
                    trans.trigger = trigger;
                    transitions.push(trans);
                    continue;
                }
            }

            // Multi-statement then block or non-chain expression
            const trans: TDTransition = {
                trigger,
                next: { type: TDTransitionType.Exit },
            };

            for (const s of thenStmts) {
                processTransitionStatement(s, trans, vars);
            }

            transitions.push(trans);
        } else if (stmt.isKind(SyntaxKind.ExpressionStatement)) {
            const expr = stmt.getExpression();

            // Check for method-chained transition
            if (isChainExpression(expr)) {
                const trans = parseTransitionChain(expr as CallExpression, vars);
                transitions.push(trans);
                continue;
            }

            // Expression statement - could be reply(), goTo(), action(), etc.
            if (Node.isCallExpression(expr)) {
                const funcName = expr.getExpression().getText();
                const args = expr.getArguments();

                // Create context for transitions array
                const context = {
                    getLastTransition: () => transitions[transitions.length - 1],
                    addTransition: (trans: TDTransition) => transitions.push(trans),
                };

                processTransitionCall(funcName, args, expr, context, vars);
            }
        } else if (stmt.isKind(SyntaxKind.ForOfStatement)) {
            // Unroll loop
            unrollForOf(stmt as ForOfStatement, vars, (s) => {
                processExtendStatements([s], transitions, vars);
            });
        } else if (stmt.isKind(SyntaxKind.ForStatement)) {
            // Unroll loop
            unrollFor(stmt as ForStatement, vars, (s) => {
                processExtendStatements([s], transitions, vars);
            });
        }
    }
}
