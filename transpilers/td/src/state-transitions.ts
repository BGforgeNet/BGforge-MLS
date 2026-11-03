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
 */

import {
    type CallExpression,
    type FunctionDeclaration,
    type FunctionExpression,
    type IfStatement,
    type Statement,
    Node,
    SyntaxKind,
} from "ts-morph";
import { TDTransitionType, type TDState, type TDTransition } from "./types";
import {
    bindArguments,
    conjunction,
    declareStatements,
    evaluateCondition,
    negate,
    type Condition,
    type Scope,
} from "../../common/compile-time-eval";
import type { FunctionValue } from "../../common/compile-time-value";
import { getBlockStatements } from "../../common/transpiler-utils";
import { TranspileError } from "../../common/transpile-error";
import {
    blockScope,
    booleanOption,
    calledHelper,
    getCallArg,
    getCallArgs,
    integerOf,
    isDeclaration,
    nameOf,
    optionalCallArg,
    optionsOf,
    stateLabelOf,
    unrollLoop,
    validateArgs,
} from "./parse-helpers";
import { STATE_ENTRY, requiredTriggerOf, textOf, transitionTrigger } from "./expression-eval";

/** The condition an if outside any other branch inherits: none. */
const ALWAYS: Condition = { kind: "constant", value: true };
import { isChainExpression, parseTransitionChain } from "./chain-parsing";
import {
    addsWholeTransitions,
    conjoinTriggers,
    processTransitionCall,
    processTransitionStatement,
} from "./transition-calls";
export { processExtendStatements } from "./transition-calls";
import { lineNumberOfNode } from "../../common/line-index";

/** A function the source declares, as a state the dialog may collect by name. */
interface FuncInfo {
    func: FunctionDeclaration;
    /**
     * The scope the function closes over, where it is known without a reference that evaluates to the function:
     * the module, or the block of a module-level `if` around it. Unset for a function declared elsewhere.
     */
    closure?: Scope;
    /** The state entry trigger a module-level `if` around the function gives it. */
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
 *
 * Accepts both `FunctionDeclaration` (named, top-level - the common path from
 * parse-constructs / state-resolution) and `FunctionExpression` (anonymous,
 * value-position - used by `replace()` patch state-object literals). Both
 * shapes implement `getName()` and `getBody()` via the `NameableNode` /
 * `BodiedNode` ts-morph mixins.
 *
 * @param closure The scope the function's body reads names from.
 */
function transformFunctionToState(
    func: FunctionDeclaration | FunctionExpression,
    closure: Scope,
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
        // ts-morph counts lines from 1; everything downstream of the bundler counts from 0.
        line: lineNumberOfNode(func) - 1,
    };

    // Track the "pending" reply transition across statements so that
    // goTo()/exit()/action() modify the correct transition, not one from
    // an unrelated inlined function or if block.
    const pending: PendingTransition = { ref: undefined };

    const statements = body.getStatements();
    const scope = blockScope(closure, statements);
    for (const stmt of statements) {
        processStateStatement(stmt, state, scope, funcs, pending);
    }

    return state;
}

/**
 * Process a statement inside a state function.
 * @param pending Tracks the last transition created by a statement-form reply()
 *   so that goTo()/exit()/action() can modify it. If/inline blocks clear this
 *   reference so subsequent calls don't accidentally modify their transitions.
 * @param nested Whether the statement sits in an if body, whose trigger guards transitions; an if there is
 *   never the state's entry trigger.
 */
function processStateStatement(
    stmt: Statement,
    state: TDState,
    scope: Scope,
    funcs: FuncsContext,
    pending: PendingTransition = makePendingTransition(),
    nested = false,
) {
    if (isDeclaration(stmt)) return;
    if (stmt.isKind(SyntaxKind.ExpressionStatement)) {
        const expr = stmt.getExpression();

        // Check for method-chained transition: reply(x).goTo(y), action(x).exit()
        if (isChainExpression(expr)) {
            const trans = parseTransitionChain(expr as CallExpression, scope);
            state.transitions.push(trans);
            // Chain transitions are complete - clear pending so goTo()/exit()
            // after this don't accidentally modify it.
            pending.ref = undefined;
            return;
        }

        if (!Node.isCallExpression(expr)) {
            throw TranspileError.fromNode(stmt, `${expr.getKindName()} is not supported as a statement in a state`);
        }
        const funcName = expr.getExpression().getText();
        const args = expr.getArguments();

        // Handle say() - specific to states, supports variadic say(t1, t2, t3)
        if (funcName === SAY_KEYWORD) {
            validateArgs(SAY_KEYWORD, args, 1, lineNumberOfNode(expr));
            for (const arg of getCallArgs(args, expr)) {
                state.say.push({ text: textOf(arg, scope) });
            }
        }
        // Handle weight() - specific to states
        else if (funcName === "weight") {
            validateArgs("weight", args, 1, lineNumberOfNode(expr));
            state.weight = integerOf(getCallArg(args, 0, expr), scope, "a state's weight");
        }
        // Handle copyTrans() at state level
        else if (funcName === "copyTrans") {
            validateArgs("copyTrans", args, 2, lineNumberOfNode(expr));
            const options = optionsOf(optionalCallArg(args, 2, expr), scope, ["safe"], "copyTrans");
            state.transitions.push({
                next: {
                    type: TDTransitionType.CopyTrans,
                    filename: nameOf(getCallArg(args, 0, expr), scope, "a dialog file name"),
                    target: stateLabelOf(getCallArg(args, 1, expr), scope),
                    safe: booleanOption(options, "safe", expr) || undefined,
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

            if (processTransitionCall(funcName, args, expr, context, scope)) return;

            // Not a transition call: a function the source declares, inlined in place.
            // Inlined functions produce complete transitions, so clear pending.
            const helper = calledHelper(expr, scope);
            if (helper === undefined) {
                throw TranspileError.fromNode(expr, `'${funcName}()' is not a TD state statement`);
            }
            pending.ref = undefined;
            inlineUserFunction(expr, helper, state, scope, funcs, nested);
        }
    } else if (stmt.isKind(SyntaxKind.IfStatement)) {
        // if (trigger) { ... } - transition with trigger.
        // Clear pending since if blocks produce complete transitions.
        pending.ref = undefined;
        processIfTransition(stmt, state, scope, funcs, nested);
    } else if (stmt.isKind(SyntaxKind.ForOfStatement) || stmt.isKind(SyntaxKind.ForStatement)) {
        unrollLoop(stmt, scope, (body, iteration) => {
            for (const s of body) processStateStatement(s, state, iteration, funcs, pending, nested);
        });
    } else if (stmt.isKind(SyntaxKind.Block)) {
        const inner = blockScope(scope, stmt.getStatements());
        for (const s of stmt.getStatements()) processStateStatement(s, state, inner, funcs, pending, nested);
    } else {
        throw TranspileError.fromNode(stmt, `${stmt.getKindName()} is not supported in a state`);
    }
}

// =========================================================================
// If/Transition Processing
// =========================================================================

/**
 * Process an if statement as a transition with trigger.
 * Also detects state-level wrapping if (where the if wraps the entire body
 * including say()), in which case it becomes a state trigger.
 */
function processIfTransition(
    ifStmt: IfStatement,
    state: TDState,
    scope: Scope,
    funcs: FuncsContext,
    nested: boolean,
    inherited: Condition = ALWAYS,
) {
    const thenStmts = getBlockStatements(ifStmt.getThenStatement());
    const thenScope = blockScope(scope, thenStmts);

    // Detect state-level wrapping if: single if wrapping say() + transitions
    // This becomes a state entry trigger, not a transition condition.
    // Pattern: if (cond) { say(...); transitions } with no prior say/transitions
    if (!nested && state.say.length === 0 && state.transitions.length === 0 && !ifStmt.getElseStatement()) {
        const hasSay = thenStmts.some((s) => {
            if (!s.isKind(SyntaxKind.ExpressionStatement)) return false;
            const e = s.getExpression();
            if (!Node.isCallExpression(e)) return false;
            const name = e.getExpression().getText();
            return name === SAY_KEYWORD;
        });
        if (hasSay) {
            // This is a state-level trigger wrapping the entire body
            const trigger = requiredTriggerOf(ifStmt.getExpression(), scope, STATE_ENTRY);
            state.trigger = conjoinTriggers(state.trigger, trigger);
            const wrappingPending: PendingTransition = { ref: undefined };
            for (const s of thenStmts) {
                processStateStatement(s, state, thenScope, funcs, wrappingPending);
            }
            return;
        }
    }

    // Each branch is guarded by its own condition and the negation of every branch before it, so exactly one of
    // a chain's replies is offered, as TypeScript would run one branch. A compile-time condition keeps one branch.
    const own = evaluateCondition(ifStmt.getExpression(), scope);
    const trigger = transitionTrigger(conjunction([inherited, own]));
    if (trigger !== false) {
        processTriggeredBlock(thenStmts, thenScope, trigger === true ? undefined : trigger, state, funcs);
    }
    processIfElseBranch(ifStmt, state, scope, funcs, conjunction([inherited, negate(own)]));
}

/**
 * The transitions an if body (or an else block) adds, each guarded by `trigger`.
 *
 * A body of method chains, helper calls, loops and nested ifs adds whole transitions, and the trigger joins
 * each one's own. A body of statement-form calls (`reply()`, `action()`, `goTo()`) builds a single transition.
 */
function processTriggeredBlock(
    statements: readonly Statement[],
    scope: Scope,
    trigger: string | undefined,
    state: TDState,
    funcs: FuncsContext,
) {
    if (addsWholeTransitions(statements, (call) => calledHelper(call, scope) !== undefined)) {
        const prevCount = state.transitions.length;
        const innerPending: PendingTransition = { ref: undefined };
        for (const s of statements) processStateStatement(s, state, scope, funcs, innerPending, true);
        for (const trans of state.transitions.slice(prevCount)) {
            trans.trigger = conjoinTriggers(trigger, trans.trigger);
        }
        return;
    }

    // Create transition with trigger
    const trans: TDTransition = {
        trigger,
        next: { type: TDTransitionType.Exit }, // Default
    };
    state.transitions.push(trans);

    // Process then block to fill in transition details
    const onInline = (expr: CallExpression): TDTransition[] | undefined => {
        const helper = calledHelper(expr, scope);
        if (helper === undefined) return undefined;
        const prevCount = state.transitions.length;
        inlineUserFunction(expr, helper, state, scope, funcs, true);
        return state.transitions.splice(prevCount);
    };
    for (const s of statements) {
        processTransitionStatement(s, trans, scope, onInline);
    }
}

/** The else or else-if branch of an if, under `otherwise`: the negation of every condition before it. */
function processIfElseBranch(
    ifStmt: IfStatement,
    state: TDState,
    scope: Scope,
    funcs: FuncsContext,
    otherwise: Condition,
) {
    const elseStmt = ifStmt.getElseStatement();
    if (!elseStmt) return;

    if (Node.isIfStatement(elseStmt)) {
        // else if - recurse; as an else branch it is never the state's entry trigger
        processIfTransition(elseStmt, state, scope, funcs, true, otherwise);
        return;
    }
    const trigger = transitionTrigger(otherwise);
    if (trigger === false) return;
    const elseStmts = getBlockStatements(elseStmt);
    processTriggeredBlock(
        elseStmts,
        blockScope(scope, elseStmts),
        trigger === true ? undefined : trigger,
        state,
        funcs,
    );
}

// =========================================================================
// User Function Inlining
// =========================================================================

/**
 * Inline a call to a function the source declares into a state, its parameters bound to the call's argument
 * values in a scope of the function's own.
 */
function inlineUserFunction(
    call: CallExpression,
    helper: FunctionValue,
    state: TDState,
    callerScope: Scope,
    funcs: FuncsContext,
    nested: boolean,
) {
    const statements = helper.declaration.getBody()?.asKind(SyntaxKind.Block)?.getStatements() ?? [];
    const scope = bindArguments(helper, call, callerScope);
    declareStatements(scope, statements);

    // Process function body with its own pending scope so reply()/goTo()
    // within the inlined body track correctly and don't leak to the caller.
    const innerPending: PendingTransition = { ref: undefined };
    for (const stmt of statements) {
        processStateStatement(stmt, state, scope, funcs, innerPending, nested);
    }
}

export { transformFunctionToState, processStateStatement, type FuncInfo, type FuncsContext };
