/**
 * TD construct transforms - handles begin(), append(), replaceState(),
 * extendTop/Bottom(), interject() and their supporting helpers.
 *
 * Extracted from parse.ts. These are the per-construct transform functions
 * invoked by transformTopLevelCall() in parse.ts.
 */

import { type CallExpression, type Expression, Node } from "ts-morph";
import {
    TDConstructType,
    TDPatchOp,
    TDEpilogueType,
    type TDConstruct,
    type TDState,
    type TDTransition,
    type TDChainEntry,
    type TDChainEpilogue,
    type TDBegin,
    type TDAppend,
    type TDExtend,
    type TDInterject,
    type TDReplaceStates,
} from "./types";
import { evaluate, type Scope } from "../../common/compile-time-eval";
import { describeKind, type Value } from "../../common/compile-time-value";
import {
    blockScope,
    booleanOption,
    getCallArg,
    integerOf,
    nameOf,
    optionalCallArg,
    optionsOf,
    stateLabelOf,
} from "./parse-helpers";
import { TranspileError } from "../../common/transpile-error";
import {
    type FuncsContext,
    processExtendStatements,
    processStateStatement,
    transformFunctionToState,
} from "./state-transitions";
import { processChainStatements } from "./chain-processing";
import { lineNumberOfNode } from "../../common/line-index";

/** What a construct transform reads: the function registry, and the scope its arguments are evaluated in. */
interface ConstructContext {
    readonly funcs: FuncsContext;
    readonly scope: Scope;
}

/**
 * Transform begin(filename, [states]) or begin(filename, s1, s2, ...) to BEGIN.
 * Supports array form, rest-args form, and object form.
 */
export function transformBegin(ctx: ConstructContext, call: CallExpression): TDConstruct[] | null {
    const args = call.getArguments();
    if (args.length < 2) {
        throw TranspileError.fromNode(call, `begin() requires at least 2 arguments`);
    }

    const filename = nameOf(getCallArg(args, 0, call), ctx.scope, "a dialog file name");
    const states: TDState[] = [];

    // Check for options as last argument (distinguished from object-form states)
    const lastArg = args[args.length - 1];
    const hasOptionsArg = lastArg && Node.isObjectLiteralExpression(lastArg) && !isObjectWithMethods(lastArg);
    const options = hasOptionsArg ? optionsOf(lastArg, ctx.scope, ["nonPausing"], "begin") : new Map<string, Value>();
    const nonPausing = booleanOption(options, "nonPausing", call) || undefined;
    const stateArgs = hasOptionsArg ? args.slice(1, -1) : args.slice(1);

    // Process state arguments
    collectStatesFromArgs(ctx, stateArgs, states, "begin");

    if (states.length === 0) {
        return null;
    }

    const begin: TDBegin = {
        type: TDConstructType.Begin,
        filename,
        nonPausing,
        states,
    };

    return [begin];
}

/**
 * Transform append/appendEarly to APPEND construct.
 * Supports array form, rest-args form, single function, and object form.
 */
export function transformAppend(ctx: ConstructContext, call: CallExpression, isEarly: boolean): TDConstruct[] | null {
    const funcName = isEarly ? "appendEarly" : "append";
    const args = call.getArguments();
    if (args.length < 2) {
        throw TranspileError.fromNode(call, `${funcName}() requires at least 2 arguments`);
    }

    const filename = nameOf(getCallArg(args, 0, call), ctx.scope, "a dialog file name");
    const states: TDState[] = [];

    // Check for options as last argument (distinguished from object-form states)
    const lastArg = args[args.length - 1];
    const hasOptionsArg = lastArg && Node.isObjectLiteralExpression(lastArg) && !isObjectWithMethods(lastArg);
    const options = hasOptionsArg
        ? optionsOf(lastArg, ctx.scope, ["ifFileExists"], funcName)
        : new Map<string, Value>();
    const ifFileExists = booleanOption(options, "ifFileExists", call) || undefined;
    const stateArgs = hasOptionsArg ? args.slice(1, -1) : args.slice(1);

    // Process state arguments
    collectStatesFromArgs(ctx, stateArgs, states, funcName);

    const append: TDAppend = {
        type: TDConstructType.Append,
        filename,
        ifFileExists,
        early: isEarly || undefined,
        states,
    };

    return [append];
}

/**
 * Transform replaceState(dialog, stateNum, body) to a patch that replaces a state.
 */
export function transformReplaceState(ctx: ConstructContext, call: CallExpression): TDConstruct[] | null {
    const args = call.getArguments();
    if (args.length < 3) {
        throw TranspileError.fromNode(call, `replaceState() requires 3 arguments (dialog, stateNum, body)`);
    }

    const filename = nameOf(getCallArg(args, 0, call), ctx.scope, "a dialog file name");
    const stateNum = integerOf(getCallArg(args, 1, call), ctx.scope, "replaceState()'s state number");
    const bodyArg = args[2];

    if (!Node.isArrowFunction(bodyArg) && !Node.isFunctionExpression(bodyArg)) {
        throw TranspileError.fromNode(call, `replaceState() body must be a function`);
    }

    // Create a temporary FunctionDeclaration-like for parsing
    const body = bodyArg.getBody();
    if (!Node.isBlock(body)) {
        throw TranspileError.fromNode(call, `replaceState() body must be a block`);
    }

    // Build state from body statements
    const state: TDState = {
        label: stateNum.toString(),
        say: [],
        transitions: [],
        // ts-morph counts lines from 1; everything downstream of the bundler counts from 0.
        line: lineNumberOfNode(call) - 1,
    };

    const statements = body.getStatements();
    const scope = blockScope(ctx.scope, statements);
    for (const s of statements) {
        processStateStatement(s, state, scope, ctx.funcs);
    }

    const operation: TDReplaceStates = {
        op: TDPatchOp.ReplaceStates,
        filename,
        replacements: new Map([[stateNum, state]]),
    };

    return [{ type: TDConstructType.Patch, operation }];
}

/**
 * Transform extendTop/extendBottom to EXTEND.
 * Signatures:
 *   extendTop(filename, state, transitions)
 *   extendBottom(filename, state, options, transitions)
 *   extendBottom(filename, state, transitions)
 */
export function transformExtend(ctx: ConstructContext, call: CallExpression, isTop: boolean): TDConstruct[] | null {
    const funcName = isTop ? "extendTop" : "extendBottom";
    const args = call.getArguments();
    if (args.length < 3) {
        throw TranspileError.fromNode(call, `${funcName}() requires at least 3 arguments`);
    }

    const filename = nameOf(getCallArg(args, 0, call), ctx.scope, "a dialog file name");
    const stateLabel = stateLabelOf(getCallArg(args, 1, call), ctx.scope);

    // Check if 3rd arg is options object or transitions function
    let position: number | undefined;
    let transitionsArg: Expression;

    if (args.length === 4) {
        // 4 args: filename, state, options, transitions
        transitionsArg = getCallArg(args, 3, call);
        const optionsArg = getCallArg(args, 2, call);
        const options = optionsOf(optionsArg, ctx.scope, ["position"], funcName);
        const positionValue = options.get("position");
        if (positionValue !== undefined) {
            if (positionValue.kind !== "int") {
                throw TranspileError.fromNode(
                    optionsArg,
                    `a position is an integer, not ${describeKind(positionValue)}`,
                );
            }
            position = positionValue.value;
        }
    } else if (args.length === 3) {
        // 3 args: filename, state, transitions
        transitionsArg = getCallArg(args, 2, call);
    } else {
        throw TranspileError.fromNode(call, `${funcName}() takes 3 or 4 arguments`);
    }

    // Extract transitions from arrow function body
    const transitions: TDTransition[] = [];
    if (Node.isArrowFunction(transitionsArg)) {
        const body = transitionsArg.getBody();
        if (Node.isBlock(body)) {
            // Process all statements together to build transitions
            const statements = body.getStatements();
            processExtendStatements(statements, transitions, blockScope(ctx.scope, statements));
        }
    } else {
        throw TranspileError.fromNode(call, `${funcName}() transitions argument must be an arrow function`);
    }

    const extend: TDExtend = {
        type: isTop ? TDConstructType.ExtendTop : TDConstructType.ExtendBottom,
        filename,
        stateLabel,
        transitions,
        position,
    };

    return [extend];
}

/**
 * Transform interject() variants to INTERJECT.
 * interject(entryFile, entryLabel, globalVar, chainFunc, exitFile, exitLabel)
 * interjectCopyTrans(entryFile, entryLabel, globalVar, chainFunc, options?)
 * interjectCopyTrans2(entryFile, entryLabel, globalVar, chainFunc)
 */
export function transformInterject(
    ctx: ConstructContext,
    call: CallExpression,
    type: TDConstructType.Interject | TDConstructType.InterjectCopyTrans | TDConstructType.InterjectCopyTrans2,
): TDConstruct[] | null {
    const args = call.getArguments();
    const funcName =
        type === TDConstructType.Interject
            ? "interject"
            : type === TDConstructType.InterjectCopyTrans
              ? "interjectCopyTrans"
              : "interjectCopyTrans2";
    const minArgs = type === TDConstructType.Interject ? 6 : 4;

    if (args.length < minArgs) {
        throw TranspileError.fromNode(call, `${funcName}() requires at least ${minArgs} arguments`);
    }

    const entryFile = nameOf(getCallArg(args, 0, call), ctx.scope, "a dialog file name");
    const entryLabel = stateLabelOf(getCallArg(args, 1, call), ctx.scope);
    const globalVar = nameOf(getCallArg(args, 2, call), ctx.scope, "an interjection's variable name");
    const chainFunc = args[3];

    // Check for safe option (interjectCopyTrans only, arg 5)
    const safe =
        type === TDConstructType.InterjectCopyTrans &&
        booleanOption(optionsOf(optionalCallArg(args, 4, call), ctx.scope, ["safe"], funcName), "safe", call);

    // Parse chain function body to get entries
    const entries: TDChainEntry[] = [];

    if (Node.isArrowFunction(chainFunc)) {
        const body = chainFunc.getBody();
        if (Node.isBlock(body)) {
            const statements = body.getStatements();
            const currentEntry = processChainStatements(statements, entries, null, blockScope(ctx.scope, statements));

            // Push final entry
            if (currentEntry) {
                entries.push(currentEntry);
            }
        }
    }

    if (entries.length === 0) {
        throw TranspileError.fromNode(call, `${funcName}() chain function must have at least one say()`);
    }

    // Determine epilogue. Only a plain INTERJECT has one: INTERJECT_COPY_TRANS already implies the
    // copy, so WeiDU terminates it with a bare END and accepts no epilogue in that position.
    let epilogue: TDChainEpilogue | undefined;
    if (type === TDConstructType.Interject) {
        const exitFile = nameOf(getCallArg(args, 4, call), ctx.scope, "a dialog file name");
        const exitLabel = stateLabelOf(getCallArg(args, 5, call), ctx.scope);
        epilogue = {
            type: TDEpilogueType.End,
            filename: exitFile,
            target: exitLabel,
        };
    }

    const interject: TDInterject = {
        type,
        filename: entryFile,
        stateLabel: entryLabel,
        globalVariable: globalVar,
        safe: safe || undefined,
        entries,
        epilogue,
    };

    return [interject];
}

/**
 * Check if an object literal has method members (used to distinguish
 * object-form states from options objects).
 */
function isObjectWithMethods(node: Node): boolean {
    if (!Node.isObjectLiteralExpression(node)) return false;
    return node.getProperties().some((p) => Node.isMethodDeclaration(p) || Node.isFunctionExpression(p));
}

/**
 * Collect states from argument list.
 * Supports: array literal, rest-args (identifiers), object-with-methods form,
 * and inline state() calls.
 */
function collectStatesFromArgs(ctx: ConstructContext, stateArgs: Node[], states: TDState[], funcName: string): void {
    for (const arg of stateArgs) {
        if (Node.isArrayLiteralExpression(arg)) {
            // Array of state references: [s1, s2, state("label", () => {...})]
            for (const element of arg.getElements()) {
                if (isInlineState(element)) {
                    collectInlineState(ctx, element, states);
                } else {
                    collectStateRefs(ctx, element, states, funcName);
                }
            }
        } else if (isInlineState(arg)) {
            // Inline state: begin("DLG", state("label", () => {...}))
            collectInlineState(ctx, arg, states);
        } else if (Node.isObjectLiteralExpression(arg)) {
            // Object form: begin("DLG", { s1() {...}, s2() {...} })
            for (const prop of arg.getProperties()) {
                if (!Node.isMethodDeclaration(prop)) {
                    throw TranspileError.fromNode(prop, `an object of states holds methods, one per state`);
                }
                const body = prop.getBody();
                if (!body || !Node.isBlock(body)) continue;

                const state: TDState = {
                    label: prop.getName(),
                    say: [],
                    transitions: [],
                };

                const statements = body.getStatements();
                const scope = blockScope(ctx.scope, statements);
                for (const s of statements) {
                    processStateStatement(s, state, scope, ctx.funcs);
                }

                states.push(state);
            }
        } else {
            // Rest-args form: begin("DLG", s1, s2, s3)
            collectStateRefs(ctx, arg, states, funcName);
        }
    }
}

function isInlineState(node: Node): node is CallExpression {
    return Node.isCallExpression(node) && node.getExpression().getText() === "state";
}

/**
 * Process an inline state() call expression: state("label", () => { ... })
 */
function collectInlineState(ctx: ConstructContext, call: CallExpression, states: TDState[]): void {
    const args = call.getArguments();
    if (args.length < 2) {
        throw TranspileError.fromNode(call, `state() requires 2 arguments (label, body)`);
    }

    const label = stateLabelOf(getCallArg(args, 0, call), ctx.scope);
    const bodyArg = args[1];

    if (!Node.isArrowFunction(bodyArg) && !Node.isFunctionExpression(bodyArg)) {
        throw TranspileError.fromNode(call, `state() body must be a function`);
    }

    const body = bodyArg.getBody();
    if (!Node.isBlock(body)) {
        throw TranspileError.fromNode(call, `state() body must be a block`);
    }

    const state: TDState = {
        label,
        say: [],
        transitions: [],
    };

    const statements = body.getStatements();
    const scope = blockScope(ctx.scope, statements);
    for (const s of statements) {
        processStateStatement(s, state, scope, ctx.funcs);
    }

    states.push(state);
}

/** The states an expression references: a state function, or an array of them. */
function collectStateRefs(ctx: ConstructContext, element: Node, states: TDState[], funcName: string): void {
    if (!Node.isExpression(element)) {
        throw TranspileError.fromNode(element, `${element.getKindName()} is not a state reference`);
    }
    const value = evaluate(element, ctx.scope);
    const refs = value.kind === "array" ? value.items : [value];
    for (const ref of refs) {
        const state = stateOf(ctx, ref, element, funcName);
        if (state) states.push(state);
    }
}

/**
 * The state a function the source declares stands for. A reference that evaluates to the function brings its
 * closure; a name only (a body-less `declare function`) finds it in the registry, which knows the closure of a
 * function at module level or in a module-level `if`.
 */
function stateOf(ctx: ConstructContext, ref: Value, node: Node, funcName: string): TDState | null {
    if (ref.kind === "function") {
        const registered = ctx.funcs.get(ref.name);
        const trigger = registered?.func === ref.declaration ? registered.trigger : undefined;
        return transformFunctionToState(ref.declaration, ref.closure, ctx.funcs, trigger);
    }
    if (ref.kind !== "symbol") {
        throw TranspileError.fromNode(node, `${funcName}() takes state functions, not ${describeKind(ref)}`);
    }
    const funcInfo = ctx.funcs.get(ref.name);
    if (!funcInfo) {
        throw TranspileError.fromNode(node, `Function "${ref.name}" not found in ${funcName}()`);
    }
    if (funcInfo.closure === undefined) {
        throw TranspileError.fromNode(
            node,
            `the state '${ref.name}' is declared where ${funcName}() cannot reach it; declare it at module level`,
        );
    }
    return transformFunctionToState(funcInfo.func, funcInfo.closure, ctx.funcs, funcInfo.trigger);
}

export type { ConstructContext };
