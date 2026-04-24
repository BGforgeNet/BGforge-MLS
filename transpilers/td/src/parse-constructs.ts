/**
 * TD construct transforms - handles begin(), append(), replaceState(),
 * extendTop/Bottom(), interject() and their supporting helpers.
 *
 * Extracted from parse.ts. These are the per-construct transform functions
 * invoked by transformTopLevelCall() in parse.ts.
 */

import { ArrayLiteralExpression, Block, CallExpression, Expression, Node } from "ts-morph";
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
import type { VarsContext } from "../../common/transpiler-utils";
import { resolveStringExpr, parseBooleanOption, parseRequiredNumber } from "./parse-helpers";
import { TranspileError } from "../../common/transpile-error";
import {
    type FuncsContext,
    processExtendStatements,
    processStateStatement,
    transformFunctionToState,
} from "./state-transitions";
import { processChainStatements } from "./chain-processing";

/**
 * Transform begin(filename, [states]) or begin(filename, s1, s2, ...) to BEGIN.
 * Supports array form, rest-args form, and object form.
 */
export function transformBegin(
    ctx: { vars: VarsContext; funcs: FuncsContext },
    call: CallExpression,
): TDConstruct[] | null {
    const args = call.getArguments();
    if (args.length < 2) {
        throw TranspileError.fromNode(call, `begin() requires at least 2 arguments`);
    }

    const filenameArg = args[0];
    if (!filenameArg) {
        throw TranspileError.fromNode(call, `begin() requires a filename`);
    }

    const filename = resolveStringExpr(filenameArg as Expression, ctx.vars);
    const states: TDState[] = [];

    // Check for options as last argument (distinguished from object-form states)
    const lastArg = args[args.length - 1];
    const hasOptionsArg = lastArg && Node.isObjectLiteralExpression(lastArg) && !isObjectWithMethods(lastArg);
    const nonPausing = hasOptionsArg ? parseBooleanOption(lastArg, "nonPausing") || undefined : undefined;
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
export function transformAppend(
    ctx: { vars: VarsContext; funcs: FuncsContext },
    call: CallExpression,
    isEarly: boolean,
): TDConstruct[] | null {
    const funcName = isEarly ? "appendEarly" : "append";
    const args = call.getArguments();
    if (args.length < 2) {
        throw TranspileError.fromNode(call, `${funcName}() requires at least 2 arguments`);
    }

    const filenameArg = args[0];
    if (!filenameArg) {
        throw TranspileError.fromNode(call, `${funcName}() requires a filename`);
    }

    const filename = resolveStringExpr(filenameArg as Expression, ctx.vars);
    const states: TDState[] = [];

    // Check for options as last argument (distinguished from object-form states)
    const lastArg = args[args.length - 1];
    const hasOptionsArg = lastArg && Node.isObjectLiteralExpression(lastArg) && !isObjectWithMethods(lastArg);
    const ifFileExists = hasOptionsArg ? parseBooleanOption(lastArg, "ifFileExists") || undefined : undefined;
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
export function transformReplaceState(
    ctx: { vars: VarsContext; funcs: FuncsContext },
    call: CallExpression,
): TDConstruct[] | null {
    const args = call.getArguments();
    if (args.length < 3) {
        throw TranspileError.fromNode(call, `replaceState() requires 3 arguments (dialog, stateNum, body)`);
    }

    const filename = resolveStringExpr(args[0] as Expression, ctx.vars);
    const stateNum = parseRequiredNumber(args[1]!, "replaceState stateNum", call.getStartLineNumber());
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
    };

    for (const s of (body as Block).getStatements()) {
        processStateStatement(s, state, ctx.vars, ctx.funcs);
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
export function transformExtend(
    ctx: { vars: VarsContext; funcs: FuncsContext },
    call: CallExpression,
    isTop: boolean,
): TDConstruct[] | null {
    const funcName = isTop ? "extendTop" : "extendBottom";
    const args = call.getArguments();
    if (args.length < 3) {
        throw TranspileError.fromNode(call, `${funcName}() requires at least 3 arguments`);
    }

    const filenameArg = args[0];
    const stateLabelArg = args[1];

    if (!filenameArg || !stateLabelArg) {
        throw TranspileError.fromNode(call, `${funcName}() requires at least 3 arguments`);
    }

    const filename = resolveStringExpr(filenameArg as Expression, ctx.vars);
    const stateLabel = resolveStringExpr(stateLabelArg as Expression, ctx.vars);

    // Check if 3rd arg is options object or transitions function
    let position: number | undefined;
    let transitionsArg: Expression;

    if (args.length === 4) {
        // 4 args: filename, state, options, transitions
        const optionsArg = args[2];
        transitionsArg = args[3] as Expression;

        // Parse options object { position: N }
        if (Node.isObjectLiteralExpression(optionsArg)) {
            const props = optionsArg.getProperties();
            for (const prop of props) {
                if (Node.isPropertyAssignment(prop)) {
                    const name = prop.getName();
                    if (name === "position") {
                        position = Number(prop.getInitializer()?.getText());
                    }
                }
            }
        }
    } else if (args.length === 3) {
        // 3 args: filename, state, transitions
        transitionsArg = args[2] as Expression;
    } else {
        throw TranspileError.fromNode(call, `${funcName}() takes 3 or 4 arguments`);
    }

    // Extract transitions from arrow function body
    const transitions: TDTransition[] = [];
    if (Node.isArrowFunction(transitionsArg)) {
        const body = transitionsArg.getBody();
        if (Node.isBlock(body)) {
            // Process all statements together to build transitions
            processExtendStatements((body as Block).getStatements(), transitions, ctx.vars);
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
    ctx: { vars: VarsContext; funcs: FuncsContext },
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

    const entryFile = resolveStringExpr(args[0] as Expression, ctx.vars);
    const entryLabel = resolveStringExpr(args[1] as Expression, ctx.vars);
    const globalVar = resolveStringExpr(args[2] as Expression, ctx.vars);
    const chainFunc = args[3];

    // Check for safe option (interjectCopyTrans only, arg 5)
    const safe = type === TDConstructType.InterjectCopyTrans && parseBooleanOption(args[4], "safe");

    // Parse chain function body to get entries
    const entries: TDChainEntry[] = [];

    if (Node.isArrowFunction(chainFunc)) {
        const body = chainFunc.getBody();
        if (Node.isBlock(body)) {
            const statements = (body as Block).getStatements();
            const currentEntry = processChainStatements(statements, entries, null, ctx.vars);

            // Push final entry
            if (currentEntry) {
                entries.push(currentEntry);
            }
        }
    }

    if (entries.length === 0) {
        throw TranspileError.fromNode(call, `${funcName}() chain function must have at least one say()`);
    }

    // Determine epilogue
    let epilogue: TDChainEpilogue | undefined;
    if (type === TDConstructType.Interject) {
        const exitFile = resolveStringExpr(args[4] as Expression, ctx.vars);
        const exitLabel = resolveStringExpr(args[5] as Expression, ctx.vars);
        epilogue = {
            type: TDEpilogueType.End,
            filename: exitFile,
            target: exitLabel,
        };
    } else {
        epilogue = {
            type: TDEpilogueType.CopyTrans,
            filename: entryFile,
            target: entryLabel,
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
function collectStatesFromArgs(
    ctx: { vars: VarsContext; funcs: FuncsContext },
    stateArgs: Node[],
    states: TDState[],
    funcName: string,
): void {
    for (const arg of stateArgs) {
        if (Node.isArrayLiteralExpression(arg)) {
            // Array of state references: [s1, s2, state("label", () => {...})]
            for (const element of (arg as ArrayLiteralExpression).getElements()) {
                if (Node.isCallExpression(element) && element.getExpression().getText() === "state") {
                    collectInlineState(ctx, element, states);
                } else {
                    collectSingleStateRef(ctx, element, states, funcName);
                }
            }
        } else if (Node.isCallExpression(arg) && arg.getExpression().getText() === "state") {
            // Inline state: begin("DLG", state("label", () => {...}))
            collectInlineState(ctx, arg, states);
        } else if (Node.isIdentifier(arg)) {
            // Rest-args form: begin("DLG", s1, s2, s3)
            collectSingleStateRef(ctx, arg, states, funcName);
        } else if (Node.isObjectLiteralExpression(arg)) {
            // Object form: begin("DLG", { s1() {...}, s2() {...} })
            for (const prop of arg.getProperties()) {
                if (Node.isMethodDeclaration(prop)) {
                    const name = prop.getName();
                    const body = prop.getBody();
                    if (!body || !Node.isBlock(body)) continue;

                    const state: TDState = {
                        label: name,
                        say: [],
                        transitions: [],
                    };

                    for (const s of (body as Block).getStatements()) {
                        processStateStatement(s, state, ctx.vars, ctx.funcs);
                    }

                    states.push(state);
                }
            }
        }
    }
}

/**
 * Process an inline state() call expression: state("label", () => { ... })
 */
function collectInlineState(
    ctx: { vars: VarsContext; funcs: FuncsContext },
    call: CallExpression,
    states: TDState[],
): void {
    const args = call.getArguments();
    if (args.length < 2) {
        throw TranspileError.fromNode(call, `state() requires 2 arguments (label, body)`);
    }

    const label = resolveStringExpr(args[0] as Expression, ctx.vars);
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

    for (const s of (body as Block).getStatements()) {
        processStateStatement(s, state, ctx.vars, ctx.funcs);
    }

    states.push(state);
}

/**
 * Resolve a single state reference (identifier) to a TDState and push it.
 */
function collectSingleStateRef(
    ctx: { vars: VarsContext; funcs: FuncsContext },
    element: Node,
    states: TDState[],
    funcName: string,
): void {
    if (Node.isIdentifier(element)) {
        const refName = element.getText();
        const funcInfo = ctx.funcs.get(refName);
        if (!funcInfo) {
            throw TranspileError.fromNode(element, `Function "${refName}" not found in ${funcName}()`);
        }
        const state = transformFunctionToState(funcInfo.func, ctx.vars, ctx.funcs, funcInfo.trigger);
        if (state) {
            states.push(state);
        }
    }
}
