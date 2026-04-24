/**
 * TD chain syntax transforms - handles chain() top-level call and
 * its two syntax forms (old function-based form and new arrow-function form).
 *
 * Extracted from parse.ts. Called by transformTopLevelCall() in parse.ts.
 */

import { Block, CallExpression, Expression, FunctionExpression, Node } from "ts-morph";
import { TDConstructType, TDEpilogueType, type TDConstruct, type TDChainEntry, type TDChainEpilogue } from "./types";
import type { VarsContext } from "../../common/transpiler-utils";
import { resolveStringExpr } from "./parse-helpers";
import { TranspileError } from "../../common/transpile-error";
import { expressionToTrigger } from "./expression-eval";
import { transformFunctionToChain, processChainBody } from "./chain-processing";
import type { FuncsContext } from "./state-transitions";

/**
 * Transform chain() to CHAIN construct.
 * Signatures:
 *   chain(function name() { ... })                    - old form
 *   chain(trigger, function name() { ... })           - old form with trigger
 *   chain(dialog, label, body)                        - new form
 *   chain(entryTrigger, dialog, label, body, options) - new form with trigger
 */
export function transformChainCall(
    ctx: { vars: VarsContext; funcs: FuncsContext },
    call: CallExpression,
): TDConstruct[] | null {
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
        return transformChainNewForm(ctx, call);
    }

    // Old form: chain(function) or chain(trigger, function)
    let trigger: string | undefined;
    let funcArg: Node;

    if (args.length === 1) {
        funcArg = args[0]!;
    } else {
        trigger = expressionToTrigger(args[0] as Expression, ctx.vars);
        funcArg = args[1]!;
    }

    if (Node.isIdentifier(funcArg)) {
        const funcName = funcArg.getText();
        const funcInfo = ctx.funcs.get(funcName);
        if (!funcInfo) {
            throw TranspileError.fromNode(funcArg, `Function "${funcName}" not found in chain()`);
        }
        const chain = transformFunctionToChain(funcInfo.func, ctx.vars, trigger);
        return chain ? [chain] : null;
    } else if (Node.isFunctionExpression(funcArg)) {
        const chain = transformFunctionToChain(funcArg as FunctionExpression, ctx.vars, trigger);
        return chain ? [chain] : null;
    }

    throw TranspileError.fromNode(call, `chain() argument must be a function reference or expression`);
}

/**
 * Transform new-form chain: chain(dialog, label, body) or chain(trigger, dialog, label, body).
 * The body is an arrow function with from()/fromWhen()/say() calls.
 */
function transformChainNewForm(
    ctx: { vars: VarsContext; funcs: FuncsContext },
    call: CallExpression,
): TDConstruct[] | null {
    const args = call.getArguments();
    let trigger: string | undefined;
    let dialog: string;
    let label: string;
    let bodyArg: Expression;

    if (Node.isArrowFunction(args[2])) {
        // chain(dialog, label, body)
        dialog = resolveStringExpr(args[0] as Expression, ctx.vars);
        label = resolveStringExpr(args[1] as Expression, ctx.vars);
        bodyArg = args[2] as Expression;
    } else if (args[3] && Node.isArrowFunction(args[3])) {
        // chain(trigger, dialog, label, body)
        trigger = expressionToTrigger(args[0] as Expression, ctx.vars);
        dialog = resolveStringExpr(args[1] as Expression, ctx.vars);
        label = resolveStringExpr(args[2] as Expression, ctx.vars);
        bodyArg = args[3] as Expression;
    } else {
        throw TranspileError.fromNode(call, `chain() body must be an arrow function`);
    }

    // Parse body to extract chain entries
    const entries: TDChainEntry[] = [];
    let epilogue: TDChainEpilogue = { type: TDEpilogueType.Exit };

    if (Node.isArrowFunction(bodyArg)) {
        const body = bodyArg.getBody();
        if (Node.isBlock(body)) {
            const result = processChainBody((body as Block).getStatements(), dialog, ctx.vars);
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
