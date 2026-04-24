/**
 * TD state and transition processing - transforms TypeScript functions
 * into WeiDU D states and transitions.
 *
 * Supports two syntax forms:
 * - Statement form: reply(); action(); goTo();
 * - Chain form:     reply(text).action(...).goTo(target)
 *
 * Chain parsing extracted to chain-parsing.ts.
 * Chain body processing extracted to chain-processing.ts.
 * Transition call dispatch extracted to transition-calls.ts.
 * Loop unrolling extracted to inline-and-unroll.ts.
 */

import {
    CallExpression,
    Expression,
    ForOfStatement,
    ForStatement,
    FunctionDeclaration,
    IfStatement,
    Node,
    Statement,
    SyntaxKind,
} from "ts-morph";
import { TDTransitionType, type TDState, type TDTransition } from "./types";
import * as utils from "../../common/transpiler-utils";
import type { VarsContext } from "../../common/transpiler-utils";
import { resolveStringExpr, validateArgs, parseBooleanOption, parseRequiredNumber } from "./parse-helpers";
import { expressionToTrigger, expressionToText } from "./expression-eval";
import { isChainExpression, parseTransitionChain } from "./chain-parsing";
import { processTransitionCall, processTransitionStatement, processExtendStatements } from "./transition-calls";
import { unrollForOf, unrollFor } from "./inline-and-unroll";

/** Function info including optional entry trigger from if-wrapping */
interface FuncInfo {
    func: FunctionDeclaration;
    trigger?: string;
}

/** Context for user function inlining */
type FuncsContext = Map<string, FuncInfo>;

/** TD say keyword constant */
const SAY_KEYWORD = "say";

/**
 * Tracks the "pending" transition created by a statement-form `reply()` call.
 * Used so that a subsequent `goTo()/exit()/action()` can modify the correct
 * transition rather than one from an unrelated inlined function or if block.
 */
interface PendingTransition {
    ref: TDTransition | undefined;
}

function makePendingTransition(): PendingTransition {
    return { ref: undefined };
}

// =========================================================================
// State Processing
// =========================================================================

/**
 * Transform a function to a STATE.
 */
function transformFunctionToState(
    func: FunctionDeclaration,
    vars: VarsContext,
    funcs: FuncsContext,
    entryTrigger?: string,
): TDState | null {
    const name = func.getName();
    if (!name) return null;

    const body = func.getBody()?.asKind(SyntaxKind.Block);
    if (!body) return null;

    const state: TDState = {
        label: name,
        trigger: entryTrigger,
        say: [],
        transitions: [],
    };

    // Track the "pending" reply transition across statements so that
    // goTo()/exit()/action() modify the correct transition, not one from
    // an unrelated inlined function or if block.
    const pending: PendingTransition = { ref: undefined };

    // Process body statements
    for (const stmt of body.getStatements()) {
        processStateStatement(stmt, state, vars, funcs, pending);
    }

    return state;
}

/**
 * Process a statement inside a state function.
 * @param pending Tracks the last transition created by a statement-form reply()
 *   so that goTo()/exit()/action() can modify it. If/inline blocks clear this
 *   reference so subsequent calls don't accidentally modify their transitions.
 */
function processStateStatement(
    stmt: Statement,
    state: TDState,
    vars: VarsContext,
    funcs: FuncsContext,
    pending: PendingTransition = makePendingTransition(),
) {
    if (stmt.isKind(SyntaxKind.ExpressionStatement)) {
        const expr = stmt.getExpression();

        // Check for method-chained transition: reply(x).goTo(y), action(x).exit()
        if (isChainExpression(expr)) {
            const trans = parseTransitionChain(expr as CallExpression, vars);
            state.transitions.push(trans);
            // Chain transitions are complete — clear pending so goTo()/exit()
            // after this don't accidentally modify it.
            pending.ref = undefined;
            return;
        }

        if (Node.isCallExpression(expr)) {
            const funcName = expr.getExpression().getText();
            const args = expr.getArguments();

            // Handle say() - specific to states, supports variadic say(t1, t2, t3)
            if (funcName === SAY_KEYWORD) {
                validateArgs(SAY_KEYWORD, args, 1, expr.getStartLineNumber());
                for (const arg of args) {
                    state.say.push({ text: expressionToText(arg as Expression, vars) });
                }
            }
            // Handle weight() - specific to states
            else if (funcName === "weight") {
                validateArgs("weight", args, 1, expr.getStartLineNumber());
                state.weight = parseRequiredNumber(args[0]!, "weight", expr.getStartLineNumber());
            }
            // Handle copyTrans() at state level
            else if (funcName === "copyTrans") {
                validateArgs("copyTrans", args, 2, expr.getStartLineNumber());
                const filename = resolveStringExpr(args[0] as Expression, vars);
                const target = resolveStringExpr(args[1] as Expression, vars);
                state.transitions.push({
                    next: {
                        type: TDTransitionType.CopyTrans,
                        filename,
                        target,
                        safe: parseBooleanOption(args[2], "safe") || undefined,
                    },
                });
            }
            // Handle transition calls - use unified helper.
            // Use pending.ref so goTo()/exit() only modify a transition created
            // by reply() at this scope, not one from an inlined function or if block.
            else {
                const context = {
                    getLastTransition: () => pending.ref,
                    addTransition: (trans: TDTransition) => {
                        pending.ref = trans;
                        state.transitions.push(trans);
                    },
                };

                const handled = processTransitionCall(funcName, args, expr, context, vars);

                // If not a transition call, check if it's a user function.
                // Inlined functions produce complete transitions, so clear pending.
                if (!handled) {
                    const funcInfo = funcs.get(funcName);
                    if (funcInfo) {
                        pending.ref = undefined;
                        inlineUserFunction(expr, funcInfo.func, state, vars, funcs);
                    }
                }
            }
        }
    } else if (stmt.isKind(SyntaxKind.IfStatement)) {
        // if (trigger) { ... } - transition with trigger.
        // Clear pending since if blocks produce complete transitions.
        pending.ref = undefined;
        processIfTransition(stmt as IfStatement, state, vars, funcs);
    } else if (stmt.isKind(SyntaxKind.ForOfStatement)) {
        // for (const x of arr) { ... } - unroll
        unrollForOf(stmt as ForOfStatement, vars, (s) => processStateStatement(s, state, vars, funcs, pending));
    } else if (stmt.isKind(SyntaxKind.ForStatement)) {
        // for (let i = 0; ...) { ... } - unroll
        unrollFor(stmt as ForStatement, vars, (s) => processStateStatement(s, state, vars, funcs, pending));
    }
}

// =========================================================================
// If/Transition Processing
// =========================================================================

/**
 * Build an inlining callback for processTransitionStatement that inlines a user
 * function and returns the transitions it produced (spliced from state.transitions).
 */
function buildInlineCallback(
    state: TDState,
    vars: VarsContext,
    funcs: FuncsContext,
): (expr: CallExpression, funcName: string) => TDTransition[] {
    return (expr, funcName) => {
        const funcInfo = funcs.get(funcName);
        if (!funcInfo) return [];
        const prevCount = state.transitions.length;
        inlineUserFunction(expr, funcInfo.func, state, vars, funcs);
        return state.transitions.splice(prevCount);
    };
}

/**
 * Process an if statement as a transition with trigger.
 * Also detects state-level wrapping if (where the if wraps the entire body
 * including say()), in which case it becomes a state trigger.
 */
function processIfTransition(ifStmt: IfStatement, state: TDState, vars: VarsContext, funcs: FuncsContext) {
    const trigger = expressionToTrigger(ifStmt.getExpression(), vars);
    const thenStmts = utils.getBlockStatements(ifStmt.getThenStatement());

    // Detect state-level wrapping if: single if wrapping say() + transitions
    // This becomes a state entry trigger, not a transition condition.
    // Pattern: if (cond) { say(...); transitions } with no prior say/transitions
    if (state.say.length === 0 && state.transitions.length === 0 && !ifStmt.getElseStatement()) {
        const hasSay = thenStmts.some((s) => {
            if (!s.isKind(SyntaxKind.ExpressionStatement)) return false;
            const e = s.getExpression();
            if (!Node.isCallExpression(e)) return false;
            const name = e.getExpression().getText();
            return name === SAY_KEYWORD;
        });
        if (hasSay) {
            // This is a state-level trigger wrapping the entire body
            state.trigger = trigger;
            const wrappingPending: PendingTransition = { ref: undefined };
            for (const s of thenStmts) {
                processStateStatement(s, state, vars, funcs, wrappingPending);
            }
            return;
        }
    }

    // Check if the then-block has a single chain expression or user function call
    if (thenStmts.length === 1 && thenStmts[0]?.isKind(SyntaxKind.ExpressionStatement)) {
        const innerExpr = thenStmts[0].getExpression();
        if (isChainExpression(innerExpr)) {
            const trans = parseTransitionChain(innerExpr as CallExpression, vars);
            trans.trigger = trigger;
            state.transitions.push(trans);

            // Handle else branch
            processIfElseBranch(ifStmt, state, vars, funcs);
            return;
        }

        // Check for user function call: if (cond) { userFunc(...) }
        // Inline the function body, then apply the trigger to all transitions it added.
        if (Node.isCallExpression(innerExpr)) {
            const funcName = innerExpr.getExpression().getText();
            const funcInfo = funcs.get(funcName);
            if (funcInfo) {
                const prevCount = state.transitions.length;
                inlineUserFunction(innerExpr, funcInfo.func, state, vars, funcs);
                // Apply trigger to all transitions added by the inlined function
                for (let i = prevCount; i < state.transitions.length; i++) {
                    state.transitions[i]!.trigger = trigger;
                }
                processIfElseBranch(ifStmt, state, vars, funcs);
                return;
            }
        }
    }

    // Create transition with trigger
    const trans: TDTransition = {
        trigger,
        next: { type: TDTransitionType.Exit }, // Default
    };
    state.transitions.push(trans);

    // Process then block to fill in transition details
    const onInline = buildInlineCallback(state, vars, funcs);
    for (const s of thenStmts) {
        processTransitionStatement(s, trans, vars, onInline);
    }

    // Handle else branch (creates additional transitions)
    processIfElseBranch(ifStmt, state, vars, funcs);
}

/**
 * Process else/else-if branches of an if statement.
 */
function processIfElseBranch(ifStmt: IfStatement, state: TDState, vars: VarsContext, funcs: FuncsContext) {
    const elseStmt = ifStmt.getElseStatement();
    if (!elseStmt) return;

    if (Node.isIfStatement(elseStmt)) {
        // else if - recurse
        processIfTransition(elseStmt, state, vars, funcs);
    } else {
        // else block - no trigger transition
        const elseStmts = utils.getBlockStatements(elseStmt);
        const elseTrans: TDTransition = {
            next: { type: TDTransitionType.Exit },
        };
        state.transitions.push(elseTrans);
        const onInline = buildInlineCallback(state, vars, funcs);
        for (const s of elseStmts) {
            processTransitionStatement(s, elseTrans, vars, onInline);
        }
    }
}

// =========================================================================
// User Function Inlining
// =========================================================================

/**
 * Inline a user function call into a state.
 */
function inlineUserFunction(
    call: CallExpression,
    func: FunctionDeclaration,
    state: TDState,
    vars: VarsContext,
    funcs: FuncsContext,
) {
    const body = func.getBody()?.asKind(SyntaxKind.Block);
    if (!body) return;

    const paramMap = utils.buildParamMap(call, func, vars);

    // Create scoped vars with params overlaid on current scope.
    // We mutate `vars` in-place because downstream code (loop unrolling)
    // holds a reference to it. Save and restore around the inlined body.
    const savedVars = new Map(vars);
    for (const [key, value] of paramMap) {
        vars.set(key, value);
    }

    // Process function body with its own pending scope so reply()/goTo()
    // within the inlined body track correctly and don't leak to the caller.
    const innerPending: PendingTransition = { ref: undefined };
    for (const stmt of body.getStatements()) {
        processStateStatement(stmt, state, vars, funcs, innerPending);
    }

    // Restore vars - clear and repopulate to maintain same reference
    vars.clear();
    for (const [key, value] of savedVars) {
        vars.set(key, value);
    }
}

export { transformFunctionToState, processExtendStatements, processStateStatement, type FuncsContext };
