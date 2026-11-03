/**
 * TD method chain parsing - parses reply(...).action(...).goTo(target) chains
 * into TDTransition objects.
 *
 * Handles the builder pattern: reply(text).action(...).journal(...).goTo(target)
 * by walking the chain inside-out and collecting each method call.
 */

import { type CallExpression, type Expression, Node } from "ts-morph";
import { TDTransitionType, type TDTransition } from "./types";
import type { Scope } from "../../common/compile-time-eval";
import { TranspileError } from "../../common/transpile-error";
import {
    actionsOf,
    booleanOption,
    getCallArg,
    getCallArgs,
    integerOf,
    nameOf,
    optionalCallArg,
    optionsOf,
    stateLabelOf,
    validateArgs,
} from "./parse-helpers";
import { textOf } from "./expression-eval";
import { lineNumberOfNode } from "../../common/line-index";

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
function parseTransitionChain(expr: CallExpression, scope: Scope): TDTransition {
    const steps = collectChainSteps(expr);
    const lineNumber = lineNumberOfNode(expr);

    const trans: TDTransition = {
        next: { type: TDTransitionType.Exit }, // Default terminal
    };

    for (const step of steps) {
        const arg = (index: number) => getCallArg(step.args, index, step.expr);
        switch (step.name) {
            case "reply":
                validateArgs("reply", step.args, 1, lineNumber);
                trans.reply = textOf(arg(0), scope);
                break;

            case "action":
                validateArgs("action", step.args, 1, lineNumber);
                trans.action = actionsOf(getCallArgs(step.args, step.expr), scope);
                break;

            case "goTo":
                validateArgs("goTo", step.args, 1, lineNumber);
                trans.next = { type: TDTransitionType.Goto, target: stateLabelOf(arg(0), scope) };
                break;

            case "exit":
                trans.next = { type: TDTransitionType.Exit };
                break;

            case "extern": {
                validateArgs("extern", step.args, 2, lineNumber);
                const options = optionsOf(optionalCallArg(step.args, 2, step.expr), scope, ["ifFileExists"], "extern");
                trans.next = {
                    type: TDTransitionType.Extern,
                    filename: nameOf(arg(0), scope, "a dialog file name"),
                    target: stateLabelOf(arg(1), scope),
                    ifFileExists: booleanOption(options, "ifFileExists", step.expr) || undefined,
                };
                break;
            }

            case "copyTransLate": {
                validateArgs("copyTransLate", step.args, 2, lineNumber);
                const options = optionsOf(optionalCallArg(step.args, 2, step.expr), scope, ["safe"], "copyTransLate");
                trans.next = {
                    type: TDTransitionType.CopyTrans,
                    filename: nameOf(arg(0), scope, "a dialog file name"),
                    target: stateLabelOf(arg(1), scope),
                    late: true,
                    safe: booleanOption(options, "safe", step.expr) || undefined,
                };
                break;
            }

            case "journal":
                validateArgs("journal", step.args, 1, lineNumber);
                trans.journal = textOf(arg(0), scope);
                break;

            case "solvedJournal":
                validateArgs("solvedJournal", step.args, 1, lineNumber);
                trans.solvedJournal = textOf(arg(0), scope);
                break;

            case "unsolvedJournal":
                validateArgs("unsolvedJournal", step.args, 1, lineNumber);
                trans.unsolvedJournal = textOf(arg(0), scope);
                break;

            case "flags":
                validateArgs("flags", step.args, 1, lineNumber);
                trans.flags = integerOf(arg(0), scope, "a transition's flags");
                break;

            default:
                throw TranspileError.fromNode(step.expr, `Unknown chain method "${step.name}"`);
        }
    }

    return trans;
}

export { isChainExpression, parseTransitionChain };
