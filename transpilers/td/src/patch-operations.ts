/**
 * TD patch operations - transforms TypeScript calls into WeiDU D
 * patch operations (ALTER_TRANS, ADD_STATE_TRIGGER, etc.)
 *
 * Extracted from TDParser as standalone functions that receive
 * the scope their arguments are evaluated in.
 */

import { type CallExpression, Node, SyntaxKind } from "ts-morph";
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
import { evaluate, type Scope } from "../../common/compile-time-eval";
import { describeKind } from "../../common/compile-time-value";
import {
    actionsOf,
    getCallArg,
    integerListOf,
    integerOf,
    nameOf,
    optionalCallArg,
    optionsOf,
    patchTextOf,
    stateLabelOf,
    stateListOf,
    unlessOf,
    unlessValue,
} from "./parse-helpers";
import { TranspileError } from "../../common/transpile-error";
import { patchTrigger, requiredTriggerOf, textOf } from "./expression-eval";
import { type FuncsContext, transformFunctionToState } from "./state-transitions";

/**
 * Transform alterTrans(filename, states, transitions, changes).
 */
function transformAlterTrans(call: CallExpression, scope: Scope): TDConstruct[] | null {
    const args = call.getArguments();
    if (args.length < 4) {
        throw TranspileError.fromNode(call, `alterTrans() requires 4 arguments`);
    }

    const filename = nameOf(getCallArg(args, 0, call), scope, "a dialog file name");
    const states = stateListOf(getCallArg(args, 1, call), scope);
    const transitions = integerListOf(getCallArg(args, 2, call), scope, "alterTrans()'s transitions");
    const changesObj = args[3];

    if (!Node.isObjectLiteralExpression(changesObj)) {
        throw TranspileError.fromNode(call, `alterTrans() fourth argument must be an object`);
    }

    const changes: TDAlterTrans["changes"] = {};

    for (const prop of changesObj.getProperties()) {
        const value = Node.isPropertyAssignment(prop) ? prop.getInitializer() : undefined;
        if (!Node.isPropertyAssignment(prop) || value === undefined) {
            throw TranspileError.fromNode(prop, "alterTrans() changes are written as trigger:, action: or reply:");
        }
        const propName = prop.getName();
        if (propName === "trigger") {
            // `trigger: false` is how alterTrans() clears a trigger; any other constant decides nothing.
            changes.trigger = value.isKind(SyntaxKind.FalseKeyword)
                ? false
                : requiredTriggerOf(value, scope, patchTrigger("ALTER_TRANS"));
        } else if (propName === "action") {
            changes.action = actionsOf([value], scope);
        } else if (propName === "reply") {
            changes.reply = textOf(value, scope);
        } else {
            throw TranspileError.fromNode(
                prop,
                `alterTrans() has no change '${propName}'; it takes trigger, action, reply`,
            );
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
function transformAddStateTrigger(call: CallExpression, scope: Scope): TDConstruct[] | null {
    const args = call.getArguments();
    if (args.length < 3) {
        throw TranspileError.fromNode(call, `addStateTrigger() requires at least 3 arguments`);
    }

    const operation: TDAddStateTrigger = {
        op: TDPatchOp.AddStateTrigger,
        filename: nameOf(getCallArg(args, 0, call), scope, "a dialog file name"),
        states: stateListOf(getCallArg(args, 1, call), scope),
        trigger: requiredTriggerOf(getCallArg(args, 2, call), scope, patchTrigger("ADD_STATE_TRIGGER")),
        unless: unlessOf(optionalCallArg(args, 3, call), scope, "addStateTrigger"),
    };

    return [{ type: TDConstructType.Patch, operation }];
}

/**
 * Transform addTransTrigger(filename, states, trigger, options?).
 */
function transformAddTransTrigger(call: CallExpression, scope: Scope): TDConstruct[] | null {
    const args = call.getArguments();
    if (args.length < 3) {
        throw TranspileError.fromNode(call, `addTransTrigger() requires at least 3 arguments`);
    }

    const filename = nameOf(getCallArg(args, 0, call), scope, "a dialog file name");
    const states = stateListOf(getCallArg(args, 1, call), scope);
    const trigger = requiredTriggerOf(getCallArg(args, 2, call), scope, patchTrigger("ADD_TRANS_TRIGGER"));

    // args[3] can be options object with trans and/or unless
    const optionsArg = optionalCallArg(args, 3, call);
    const options = optionsOf(optionsArg, scope, ["trans", "unless"], "addTransTrigger");
    const trans = options.get("trans");
    let transitions: number[] | undefined;
    if (trans !== undefined) {
        if (trans.kind !== "array") {
            throw TranspileError.fromNode(
                call,
                `addTransTrigger()'s trans is an array of integers, not ${describeKind(trans)}`,
            );
        }
        transitions = trans.items.map((item) => {
            if (item.kind !== "int") {
                throw TranspileError.fromNode(
                    call,
                    `addTransTrigger()'s trans holds integers, not ${describeKind(item)}`,
                );
            }
            return item.value;
        });
    }

    const operation: TDAddTransTrigger = {
        op: TDPatchOp.AddTransTrigger,
        filename,
        states,
        transitions,
        trigger,
        unless: unlessValue(options.get("unless"), call),
    };

    return [{ type: TDConstructType.Patch, operation }];
}

/**
 * Transform addTransAction(filename, states, transitions, action, options?).
 */
function transformAddTransAction(call: CallExpression, scope: Scope): TDConstruct[] | null {
    const args = call.getArguments();
    if (args.length < 4) {
        throw TranspileError.fromNode(call, `addTransAction() requires at least 4 arguments`);
    }

    const operation: TDAddTransAction = {
        op: TDPatchOp.AddTransAction,
        filename: nameOf(getCallArg(args, 0, call), scope, "a dialog file name"),
        states: stateListOf(getCallArg(args, 1, call), scope),
        transitions: integerListOf(getCallArg(args, 2, call), scope, "addTransAction()'s transitions"),
        action: actionsOf([getCallArg(args, 3, call)], scope),
        unless: unlessOf(optionalCallArg(args, 4, call), scope, "addTransAction"),
    };

    return [{ type: TDConstructType.Patch, operation }];
}

/**
 * Transform replaceTransTrigger/replaceTransAction.
 */
function transformReplaceTrans(
    call: CallExpression,
    op: TDPatchOp.ReplaceTransTrigger | TDPatchOp.ReplaceTransAction,
    scope: Scope,
): TDConstruct[] | null {
    const args = call.getArguments();
    const funcName = op === TDPatchOp.ReplaceTransTrigger ? "replaceTransTrigger" : "replaceTransAction";

    if (args.length < 5) {
        throw TranspileError.fromNode(call, `${funcName}() requires at least 5 arguments`);
    }

    const operation: TDReplaceTrans = {
        op,
        filename: nameOf(getCallArg(args, 0, call), scope, "a dialog file name"),
        states: stateListOf(getCallArg(args, 1, call), scope),
        transitions: integerListOf(getCallArg(args, 2, call), scope, `${funcName}()'s transitions`),
        oldText: patchTextOf(getCallArg(args, 3, call), scope, `${funcName}()'s search text`),
        newText: patchTextOf(getCallArg(args, 4, call), scope, `${funcName}()'s replacement text`),
        unless: unlessOf(optionalCallArg(args, 5, call), scope, funcName),
    };

    return [{ type: TDConstructType.Patch, operation }];
}

/**
 * Transform replaceTriggerText/replaceActionText.
 */
function transformReplaceText(
    call: CallExpression,
    op: TDPatchOp.ReplaceTriggerText | TDPatchOp.ReplaceActionText,
    scope: Scope,
): TDConstruct[] | null {
    const args = call.getArguments();
    const funcName = op === TDPatchOp.ReplaceTriggerText ? "replaceTriggerText" : "replaceActionText";

    if (args.length < 3) {
        throw TranspileError.fromNode(call, `${funcName}() requires at least 3 arguments`);
    }

    // Can be a single string or array of strings
    const filenamesValue = evaluate(getCallArg(args, 0, call), scope);
    const items = filenamesValue.kind === "array" ? filenamesValue.items : [filenamesValue];
    const filenames = items.map((item) => {
        if (item.kind !== "string") {
            throw TranspileError.fromNode(call, `${funcName}() first argument must be a string or array of strings`);
        }
        return item.value;
    });

    const operation: TDReplaceText = {
        op,
        filenames,
        oldText: patchTextOf(getCallArg(args, 1, call), scope, `${funcName}()'s search text`),
        newText: patchTextOf(getCallArg(args, 2, call), scope, `${funcName}()'s replacement text`),
        unless: unlessOf(optionalCallArg(args, 3, call), scope, funcName),
    };

    return [{ type: TDConstructType.Patch, operation }];
}

/**
 * Transform setWeight(filename, state, weight).
 */
function transformSetWeight(call: CallExpression, scope: Scope): TDConstruct[] | null {
    const args = call.getArguments();
    if (args.length < 3) {
        throw TranspileError.fromNode(call, `setWeight() requires 3 arguments`);
    }

    const operation: TDSetWeight = {
        op: TDPatchOp.SetWeight,
        filename: nameOf(getCallArg(args, 0, call), scope, "a dialog file name"),
        state: stateLabelOf(getCallArg(args, 1, call), scope),
        weight: integerOf(getCallArg(args, 2, call), scope, "a state's weight"),
    };

    return [{ type: TDConstructType.Patch, operation }];
}

/**
 * Transform replaceSay(filename, state, text).
 */
function transformReplaceSay(call: CallExpression, scope: Scope): TDConstruct[] | null {
    const args = call.getArguments();
    if (args.length < 3) {
        throw TranspileError.fromNode(call, `replaceSay() requires 3 arguments`);
    }

    const operation: TDReplaceSay = {
        op: TDPatchOp.ReplaceSay,
        filename: nameOf(getCallArg(args, 0, call), scope, "a dialog file name"),
        state: stateLabelOf(getCallArg(args, 1, call), scope),
        text: textOf(getCallArg(args, 2, call), scope),
    };

    return [{ type: TDConstructType.Patch, operation }];
}

/**
 * Transform replaceStateTrigger(filename, states, trigger, options?).
 */
function transformReplaceStateTrigger(call: CallExpression, scope: Scope): TDConstruct[] | null {
    const args = call.getArguments();
    if (args.length < 3) {
        throw TranspileError.fromNode(call, `replaceStateTrigger() requires at least 3 arguments`);
    }

    const operation: TDReplaceStateTrigger = {
        op: TDPatchOp.ReplaceStateTrigger,
        filename: nameOf(getCallArg(args, 0, call), scope, "a dialog file name"),
        states: stateListOf(getCallArg(args, 1, call), scope),
        trigger: requiredTriggerOf(getCallArg(args, 2, call), scope, patchTrigger("REPLACE_STATE_TRIGGER")),
        unless: unlessOf(optionalCallArg(args, 3, call), scope, "replaceStateTrigger"),
    };

    return [{ type: TDConstructType.Patch, operation }];
}

/**
 * Transform replace(filename, { stateNum: function, ... }).
 * Replaces entire states by their numeric index.
 */
function transformReplace(call: CallExpression, scope: Scope, funcs: FuncsContext): TDConstruct[] | null {
    const args = call.getArguments();
    if (args.length < 2) {
        throw TranspileError.fromNode(call, `replace() requires 2 arguments`);
    }

    const filename = nameOf(getCallArg(args, 0, call), scope, "a dialog file name");
    const statesObj = args[1];

    if (!Node.isObjectLiteralExpression(statesObj)) {
        throw TranspileError.fromNode(call, `replace() second argument must be an object literal`);
    }

    const replacements = new Map<number, TDState>();

    for (const prop of statesObj.getProperties()) {
        if (!Node.isPropertyAssignment(prop)) {
            throw TranspileError.fromNode(prop, "replace() maps state numbers to functions: 0: function name() {...}");
        }
        const stateNum = Number(prop.getName());
        if (!Number.isInteger(stateNum)) {
            throw TranspileError.fromNode(prop, `replace() keys are state numbers, not '${prop.getName()}'`);
        }
        const funcExpr = prop.getInitializer();

        if (!funcExpr || !Node.isFunctionExpression(funcExpr)) {
            throw TranspileError.fromNode(call, `replace() state ${stateNum} must be a function`);
        }

        const state = transformFunctionToState(funcExpr, scope, funcs);

        if (!state) {
            throw TranspileError.fromNode(call, `replace() failed to parse state ${stateNum}`);
        }

        // Override label with the numeric state
        state.label = stateNum.toString();
        replacements.set(stateNum, state);
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
