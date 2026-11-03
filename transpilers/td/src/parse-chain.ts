/**
 * TD chain syntax transforms - handles chain() top-level call and
 * its two syntax forms (old function-based form and new arrow-function form).
 *
 * Extracted from parse.ts. Called by transformTopLevelCall() in parse.ts.
 */

import { type CallExpression, type Expression, Node } from "ts-morph";
import { TDConstructType, TDEpilogueType, type TDConstruct, type TDChainEntry, type TDChainEpilogue } from "./types";
import { evaluate, type Scope } from "../../common/compile-time-eval";
import { blockScope, getCallArg, nameOf, stateLabelOf } from "./parse-helpers";
import { TranspileError } from "../../common/transpile-error";
import { CHAIN_ENTRY, requiredTriggerOf } from "./expression-eval";
import { transformFunctionToChain, processChainBody } from "./chain-processing";

/**
 * Transform chain() to CHAIN construct.
 * Signatures:
 *   chain(function name() { ... })                    - old form
 *   chain(trigger, function name() { ... })           - old form with trigger
 *   chain(dialog, label, body)                        - new form
 *   chain(entryTrigger, dialog, label, body, options) - new form with trigger
 */
export function transformChainCall(call: CallExpression, scope: Scope): TDConstruct[] | null {
    const args = call.getArguments();
    if (args.length < 1) {
        throw TranspileError.fromNode(call, `chain() requires at least 1 argument`);
    }

    // Detect new form: chain(dialog, label, body) or chain(trigger, dialog, label, body)
    // New form has an arrow function as the body argument (3rd or 4th).
    // Old form has a function expression or identifier as 1st or 2nd argument.
    const isNewForm =
        (args.length >= 3 && Node.isArrowFunction(args[2])) || (args.length >= 4 && Node.isArrowFunction(args[3]));

    if (isNewForm) {
        return transformChainNewForm(call, scope);
    }

    // Old form: chain(function) or chain(trigger, function)
    let trigger: string | undefined;
    let funcArg: Expression;

    if (args.length === 1) {
        funcArg = getCallArg(args, 0, call);
    } else {
        trigger = requiredTriggerOf(getCallArg(args, 0, call), scope, CHAIN_ENTRY);
        funcArg = getCallArg(args, 1, call);
    }

    if (Node.isFunctionExpression(funcArg)) {
        const chain = transformFunctionToChain(funcArg, scope, trigger);
        return chain ? [chain] : null;
    }
    const value = evaluate(funcArg, scope);
    if (value.kind === "function") {
        const chain = transformFunctionToChain(value.declaration, value.closure, trigger);
        return chain ? [chain] : null;
    }
    if (value.kind === "symbol") {
        throw TranspileError.fromNode(funcArg, `Function "${value.name}" not found in chain()`);
    }

    throw TranspileError.fromNode(call, `chain() argument must be a function reference or expression`);
}

/**
 * Transform new-form chain: chain(dialog, label, body) or chain(trigger, dialog, label, body).
 * The body is an arrow function with from()/fromWhen()/say() calls.
 */
function transformChainNewForm(call: CallExpression, scope: Scope): TDConstruct[] | null {
    const args = call.getArguments();
    let trigger: string | undefined;
    let dialog: string;
    let label: string;
    let bodyArg: Expression;

    if (Node.isArrowFunction(args[2])) {
        // chain(dialog, label, body)
        dialog = nameOf(getCallArg(args, 0, call), scope, "a dialog file name");
        label = stateLabelOf(getCallArg(args, 1, call), scope);
        bodyArg = args[2];
    } else if (args[3] && Node.isArrowFunction(args[3])) {
        // chain(trigger, dialog, label, body)
        trigger = requiredTriggerOf(getCallArg(args, 0, call), scope, CHAIN_ENTRY);
        dialog = nameOf(getCallArg(args, 1, call), scope, "a dialog file name");
        label = stateLabelOf(getCallArg(args, 2, call), scope);
        bodyArg = args[3];
    } else {
        throw TranspileError.fromNode(call, `chain() body must be an arrow function`);
    }

    // Parse body to extract chain entries
    const entries: TDChainEntry[] = [];
    let epilogue: TDChainEpilogue = { type: TDEpilogueType.Exit };

    if (Node.isArrowFunction(bodyArg)) {
        const body = bodyArg.getBody();
        if (Node.isBlock(body)) {
            const statements = body.getStatements();
            const result = processChainBody(statements, dialog, blockScope(scope, statements));
            entries.push(...result.entries);
            epilogue = result.epilogue;
        }
    }

    return [
        {
            type: TDConstructType.Chain,
            filename: dialog,
            label,
            trigger,
            entries,
            epilogue,
        },
    ];
}
