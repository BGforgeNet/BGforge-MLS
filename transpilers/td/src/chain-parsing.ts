/**
 * TD method chain parsing - parses reply(...).action(...).goTo(target) chains
 * into TDTransition objects.
 *
 * Handles the builder pattern: reply(text).action(...).journal(...).goTo(target)
 * by walking the chain inside-out and collecting each method call.
 */

import { CallExpression, Expression, Node } from "ts-morph";
import { TDTransitionType, type TDTransition } from "./types";
import * as utils from "../../common/transpiler-utils";
import type { VarsContext } from "../../common/transpiler-utils";
import {
    resolveStringExpr,
    expressionToActionString,
    validateArgs,
    parseBooleanOption,
    parseRequiredNumber,
} from "./parse-helpers";
import { expressionToText } from "./expression-eval";

/** Names that start a method chain: reply(...).xxx() or action(...).xxx(). */
const CHAIN_STARTERS = new Set(["reply", "action"]);

/**
 * Check if an expression is a method-chained transition.
 * Detects patterns like reply(x).goTo(y) or action(x).exit().
 */
function isChainExpression(expr: Expression): boolean {
    if (!Node.isCallExpression(expr)) return false;

    const callee = expr.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) return false;

    // Walk up to the root of the chain to check the starter
    let current: Expression = expr;
    while (Node.isCallExpression(current)) {
        const inner = current.getExpression();
        if (Node.isPropertyAccessExpression(inner)) {
            current = inner.getExpression();
        } else {
            break;
        }
    }

    // Root should be a call to reply() or action()
    if (Node.isCallExpression(current)) {
        const rootName = current.getExpression().getText();
        return CHAIN_STARTERS.has(rootName);
    }

    return false;
}

/** Collected step from walking a chain expression. */
interface ChainStep {
    name: string;
    args: Node[];
    expr: CallExpression;
}

/**
 * Walk a chain expression inside-out and collect method calls in order.
 * Given reply(a).action(b).goTo(c), returns:
 *   [{ name: "reply", args: [a] }, { name: "action", args: [b] }, { name: "goTo", args: [c] }]
 */
function collectChainSteps(expr: CallExpression): ChainStep[] {
    const steps: ChainStep[] = [];

    let current: Expression = expr;
    while (Node.isCallExpression(current)) {
        const callee = current.getExpression();
        const args = current.getArguments();

        if (Node.isPropertyAccessExpression(callee)) {
            // This is a .method() call in the chain
            const methodName = callee.getName();
            steps.unshift({ name: methodName, args, expr: current });
            current = callee.getExpression();
        } else {
            // This is the root call (reply/action)
            const rootName = callee.getText();
            steps.unshift({ name: rootName, args, expr: current });
            break;
        }
    }

    return steps;
}

/**
 * Parse a method-chained transition expression into a TDTransition.
 * Handles: reply(text).action(...).journal(...).goTo(target)
 *          action(...).exit()
 */
function parseTransitionChain(expr: CallExpression, vars: VarsContext): TDTransition {
    const steps = collectChainSteps(expr);
    const lineNumber = expr.getStartLineNumber();

    const trans: TDTransition = {
        next: { type: TDTransitionType.Exit }, // Default terminal
    };

    for (const step of steps) {
        switch (step.name) {
            case "reply":
                validateArgs("reply", step.args, 1, lineNumber);
                trans.reply = expressionToText(step.args[0] as Expression, vars);
                break;

            case "action": {
                validateArgs("action", step.args, 1, lineNumber);
                const actionStr = step.args.map((a) => expressionToActionString(a as Expression, vars)).join(" ");
                trans.action = actionStr;
                break;
            }

            case "goTo": {
                validateArgs("goTo", step.args, 1, lineNumber);
                const target = resolveStringExpr(step.args[0] as Expression, vars);
                trans.next = { type: TDTransitionType.Goto, target };
                break;
            }

            case "exit":
                trans.next = { type: TDTransitionType.Exit };
                break;

            case "extern": {
                validateArgs("extern", step.args, 2, lineNumber);
                trans.next = {
                    type: TDTransitionType.Extern,
                    filename: utils.stripQuotes(step.args[0]!.getText()),
                    target: utils.stripQuotes(step.args[1]!.getText()),
                    ifFileExists: parseBooleanOption(step.args[2], "ifFileExists") || undefined,
                };
                break;
            }

            case "copyTransLate": {
                validateArgs("copyTransLate", step.args, 2, lineNumber);
                trans.next = {
                    type: TDTransitionType.CopyTrans,
                    filename: utils.stripQuotes(step.args[0]!.getText()),
                    target: utils.stripQuotes(step.args[1]!.getText()),
                    late: true,
                    safe: parseBooleanOption(step.args[2], "safe") || undefined,
                };
                break;
            }

            case "journal":
                validateArgs("journal", step.args, 1, lineNumber);
                trans.journal = expressionToText(step.args[0] as Expression, vars);
                break;

            case "solvedJournal":
                validateArgs("solvedJournal", step.args, 1, lineNumber);
                trans.solvedJournal = expressionToText(step.args[0] as Expression, vars);
                break;

            case "unsolvedJournal":
                validateArgs("unsolvedJournal", step.args, 1, lineNumber);
                trans.unsolvedJournal = expressionToText(step.args[0] as Expression, vars);
                break;

            case "flags":
                validateArgs("flags", step.args, 1, lineNumber);
                trans.flags = parseRequiredNumber(step.args[0]!, "flags", lineNumber);
                break;

            default:
                throw new Error(`Unknown chain method "${step.name}" at ${lineNumber}`);
        }
    }

    return trans;
}

export { isChainExpression, parseTransitionChain };
