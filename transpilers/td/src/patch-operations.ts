/**
 * TD patch operations - transforms TypeScript calls into WeiDU D
 * patch operations (ALTER_TRANS, ADD_STATE_TRIGGER, etc.)
 *
 * Extracted from TDParser as standalone functions that receive
 * parser context (vars) as a parameter.
 */

import { CallExpression, Node, SyntaxKind } from "ts-morph";
import {
    TDConstructType,
    TDPatchOp,
    type TDConstruct,
    type TDState,
    type TDAlterTrans,
    type TDAddStateTrigger,
    type TDAddTransTrigger,
    type TDAddTransAction,
    type TDReplaceTrans,
    type TDReplaceText,
    type TDSetWeight,
    type TDReplaceSay,
    type TDReplaceStateTrigger,
    type TDReplaceStates,
} from "./types";
import * as utils from "../../common/transpiler-utils";
import type { VarsContext } from "../../common/transpiler-utils";
import { resolveStringExpr, parseStateList, parseNumberArray, parseUnless, getCallArg } from "./parse-helpers";
import { TranspileError } from "../../common/transpile-error";
import { expressionToTrigger, expressionToAction, expressionToText } from "./expression-eval";
import { type FuncsContext, transformFunctionToState } from "./state-transitions";

/**
 * Transform alterTrans(filename, states, transitions, changes).
 */
function transformAlterTrans(call: CallExpression, vars: VarsContext): TDConstruct[] | null {
    const args = call.getArguments();
    if (args.length < 4) {
        throw TranspileError.fromNode(call, `alterTrans() requires 4 arguments`);
    }

    const filename = resolveStringExpr(getCallArg(args, 0, call), vars);
    const states = parseStateList(getCallArg(args, 1, call), vars);
    const transitions = parseNumberArray(getCallArg(args, 2, call));
    const changesObj = args[3];

    if (!Node.isObjectLiteralExpression(changesObj)) {
        throw TranspileError.fromNode(call, `alterTrans() fourth argument must be an object`);
    }

    const changes: TDAlterTrans["changes"] = {};

    for (const prop of changesObj.getProperties()) {
        if (Node.isPropertyAssignment(prop)) {
            const propName = prop.getName();
            const value = prop.getInitializer();

            if (!value) continue;

            if (propName === "trigger") {
                if (value.getText() === "false") {
                    changes.trigger = false;
                } else {
                    changes.trigger = expressionToTrigger(value, vars);
                }
            } else if (propName === "action") {
                changes.action = expressionToAction(value, vars);
            } else if (propName === "reply") {
                changes.reply = expressionToText(value, vars);
            }
        }
    }

    const operation: TDAlterTrans = {
        op: TDPatchOp.AlterTrans,
        filename,
        states,
        transitions,
        changes,
    };

    return [{ type: TDConstructType.Patch, operation }];
}

/**
 * Transform addStateTrigger(filename, states, trigger, options?).
 */
function transformAddStateTrigger(call: CallExpression, vars: VarsContext): TDConstruct[] | null {
    const args = call.getArguments();
    if (args.length < 3) {
        throw TranspileError.fromNode(call, `addStateTrigger() requires at least 3 arguments`);
    }

    const filename = resolveStringExpr(getCallArg(args, 0, call), vars);
    const states = parseStateList(getCallArg(args, 1, call), vars);
    const trigger = expressionToTrigger(getCallArg(args, 2, call), vars);
    const unless = args[3] ? parseUnless(getCallArg(args, 3, call)) : undefined;

    const operation: TDAddStateTrigger = {
        op: TDPatchOp.AddStateTrigger,
        filename,
        states,
        trigger,
        unless,
    };

    return [{ type: TDConstructType.Patch, operation }];
}

/**
 * Transform addTransTrigger(filename, states, trigger, options?).
 */
function transformAddTransTrigger(call: CallExpression, vars: VarsContext): TDConstruct[] | null {
    const args = call.getArguments();
    if (args.length < 3) {
        throw TranspileError.fromNode(call, `addTransTrigger() requires at least 3 arguments`);
    }

    const filename = resolveStringExpr(getCallArg(args, 0, call), vars);
    const states = parseStateList(getCallArg(args, 1, call), vars);
    const trigger = expressionToTrigger(getCallArg(args, 2, call), vars);

    let transitions: number[] | undefined;
    let unless: string | undefined;

    // args[3] can be options object with trans and/or unless
    if (args[3]) {
        const opts = args[3];
        if (Node.isObjectLiteralExpression(opts)) {
            for (const prop of opts.getProperties()) {
                if (Node.isPropertyAssignment(prop)) {
                    const propName = prop.getName();
                    const value = prop.getInitializer();
                    if (!value) continue;

                    if (propName === "trans") {
                        transitions = parseNumberArray(value);
                    } else if (propName === "unless") {
                        unless = parseUnless(value);
                    }
                }
            }
        }
    }

    const operation: TDAddTransTrigger = {
        op: TDPatchOp.AddTransTrigger,
        filename,
        states,
        transitions,
        trigger,
        unless,
    };

    return [{ type: TDConstructType.Patch, operation }];
}

/**
 * Transform addTransAction(filename, states, transitions, action, options?).
 */
function transformAddTransAction(call: CallExpression, vars: VarsContext): TDConstruct[] | null {
    const args = call.getArguments();
    if (args.length < 4) {
        throw TranspileError.fromNode(call, `addTransAction() requires at least 4 arguments`);
    }

    const filename = resolveStringExpr(getCallArg(args, 0, call), vars);
    const states = parseStateList(getCallArg(args, 1, call), vars);
    const transitions = parseNumberArray(getCallArg(args, 2, call));
    const action = expressionToAction(getCallArg(args, 3, call), vars);
    const unless = args[4] ? parseUnless(getCallArg(args, 4, call)) : undefined;

    const operation: TDAddTransAction = {
        op: TDPatchOp.AddTransAction,
        filename,
        states,
        transitions,
        action,
        unless,
    };

    return [{ type: TDConstructType.Patch, operation }];
}

/**
 * Transform replaceTransTrigger/replaceTransAction.
 */
function transformReplaceTrans(
    call: CallExpression,
    op: TDPatchOp.ReplaceTransTrigger | TDPatchOp.ReplaceTransAction,
    vars: VarsContext,
): TDConstruct[] | null {
    const args = call.getArguments();
    const funcName = op === TDPatchOp.ReplaceTransTrigger ? "replaceTransTrigger" : "replaceTransAction";

    if (args.length < 5) {
        throw TranspileError.fromNode(call, `${funcName}() requires at least 5 arguments`);
    }

    const filename = resolveStringExpr(getCallArg(args, 0, call), vars);
    const states = parseStateList(getCallArg(args, 1, call), vars);
    const transitions = parseNumberArray(getCallArg(args, 2, call));
    const oldText = utils.resolveStringLiteral(getCallArg(args, 3, call));
    const newText = utils.resolveStringLiteral(getCallArg(args, 4, call));
    const unless = args[5] ? parseUnless(getCallArg(args, 5, call)) : undefined;

    const operation: TDReplaceTrans = {
        op,
        filename,
        states,
        transitions,
        oldText,
        newText,
        unless,
    };

    return [{ type: TDConstructType.Patch, operation }];
}

/**
 * Transform replaceTriggerText/replaceActionText.
 */
function transformReplaceText(
    call: CallExpression,
    op: TDPatchOp.ReplaceTriggerText | TDPatchOp.ReplaceActionText,
    vars: VarsContext,
): TDConstruct[] | null {
    const args = call.getArguments();
    const funcName = op === TDPatchOp.ReplaceTriggerText ? "replaceTriggerText" : "replaceActionText";

    if (args.length < 3) {
        throw TranspileError.fromNode(call, `${funcName}() requires at least 3 arguments`);
    }

    const filenamesArg = getCallArg(args, 0, call);
    let filenames: string[];

    // Can be a single string or array of strings
    if (Node.isStringLiteral(filenamesArg) || filenamesArg.getKind() === SyntaxKind.StringLiteral) {
        filenames = [resolveStringExpr(filenamesArg, vars)];
    } else if (Node.isArrayLiteralExpression(filenamesArg)) {
        filenames = filenamesArg.getElements().map((e) => resolveStringExpr(e, vars));
    } else {
        throw TranspileError.fromNode(call, `${funcName}() first argument must be a string or array of strings`);
    }

    const oldText = utils.resolveStringLiteral(getCallArg(args, 1, call));
    const newText = utils.resolveStringLiteral(getCallArg(args, 2, call));
    const unless = args[3] ? parseUnless(getCallArg(args, 3, call)) : undefined;

    const operation: TDReplaceText = {
        op,
        filenames,
        oldText,
        newText,
        unless,
    };

    return [{ type: TDConstructType.Patch, operation }];
}

/**
 * Transform setWeight(filename, state, weight).
 */
function transformSetWeight(call: CallExpression, vars: VarsContext): TDConstruct[] | null {
    const args = call.getArguments();
    if (args.length < 3) {
        throw TranspileError.fromNode(call, `setWeight() requires 3 arguments`);
    }

    const filename = resolveStringExpr(getCallArg(args, 0, call), vars);
    const state = resolveStringExpr(getCallArg(args, 1, call), vars);
    const weight = Number(getCallArg(args, 2, call).getText());

    const operation: TDSetWeight = {
        op: TDPatchOp.SetWeight,
        filename,
        state,
        weight,
    };

    return [{ type: TDConstructType.Patch, operation }];
}

/**
 * Transform replaceSay(filename, state, text).
 */
function transformReplaceSay(call: CallExpression, vars: VarsContext): TDConstruct[] | null {
    const args = call.getArguments();
    if (args.length < 3) {
        throw TranspileError.fromNode(call, `replaceSay() requires 3 arguments`);
    }

    const filename = resolveStringExpr(getCallArg(args, 0, call), vars);
    const state = resolveStringExpr(getCallArg(args, 1, call), vars);
    const text = expressionToText(getCallArg(args, 2, call), vars);

    const operation: TDReplaceSay = {
        op: TDPatchOp.ReplaceSay,
        filename,
        state,
        text,
    };

    return [{ type: TDConstructType.Patch, operation }];
}

/**
 * Transform replaceStateTrigger(filename, states, trigger, options?).
 */
function transformReplaceStateTrigger(call: CallExpression, vars: VarsContext): TDConstruct[] | null {
    const args = call.getArguments();
    if (args.length < 3) {
        throw TranspileError.fromNode(call, `replaceStateTrigger() requires at least 3 arguments`);
    }

    const filename = resolveStringExpr(getCallArg(args, 0, call), vars);
    const states = parseStateList(getCallArg(args, 1, call), vars);
    const trigger = expressionToTrigger(getCallArg(args, 2, call), vars);
    const unless = args[3] ? parseUnless(getCallArg(args, 3, call)) : undefined;

    const operation: TDReplaceStateTrigger = {
        op: TDPatchOp.ReplaceStateTrigger,
        filename,
        states,
        trigger,
        unless,
    };

    return [{ type: TDConstructType.Patch, operation }];
}

/**
 * Transform replace(filename, { stateNum: function, ... }).
 * Replaces entire states by their numeric index.
 */
function transformReplace(call: CallExpression, vars: VarsContext, funcs: FuncsContext): TDConstruct[] | null {
    const args = call.getArguments();
    if (args.length < 2) {
        throw TranspileError.fromNode(call, `replace() requires 2 arguments`);
    }

    const filename = resolveStringExpr(getCallArg(args, 0, call), vars);
    const statesObj = args[1];

    if (!Node.isObjectLiteralExpression(statesObj)) {
        throw TranspileError.fromNode(call, `replace() second argument must be an object literal`);
    }

    const replacements = new Map<number, TDState>();

    for (const prop of statesObj.getProperties()) {
        if (Node.isPropertyAssignment(prop)) {
            const stateNum = Number(prop.getName());
            const funcExpr = prop.getInitializer();

            if (!funcExpr || !Node.isFunctionExpression(funcExpr)) {
                throw TranspileError.fromNode(call, `replace() state ${stateNum} must be a function`);
            }

            const state = transformFunctionToState(funcExpr, vars, funcs);

            if (!state) {
                throw TranspileError.fromNode(call, `replace() failed to parse state ${stateNum}`);
            }

            // Override label with the numeric state
            state.label = stateNum.toString();
            replacements.set(stateNum, state);
        }
    }

    const operation: TDReplaceStates = {
        op: TDPatchOp.ReplaceStates,
        filename,
        replacements,
    };

    return [{ type: TDConstructType.Patch, operation }];
}

export {
    transformAlterTrans,
    transformAddStateTrigger,
    transformAddTransTrigger,
    transformAddTransAction,
    transformReplaceTrans,
    transformReplaceText,
    transformSetWeight,
    transformReplaceSay,
    transformReplaceStateTrigger,
    transformReplace,
};
