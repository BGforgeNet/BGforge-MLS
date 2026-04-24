/**
 * TD Parser - converts TypeScript AST to TD IR
 *
 * Walks the TypeScript AST (via ts-morph) and produces TDScript IR
 * for emission to WeiDU D format.
 *
 * Implementation is split across modules:
 * - parse-helpers.ts: utility functions (evaluate, resolve, validate, parse)
 * - expression-eval.ts: expression to trigger/action/text conversion
 * - parse-chain.ts: chain() top-level call transforms (transformChainCall)
 * - parse-constructs.ts: begin/append/extend/interject/replaceState transforms
 * - chain-parsing.ts: method chain transition parsing (reply().action().goTo())
 * - chain-processing.ts: chain body processing (from/fromWhen/say)
 * - state-transitions.ts: state/transition/extend processing, loop unrolling
 * - state-resolution.ts: transitive state collection and orphan detection
 * - patch-operations.ts: patch operation transforms (ALTER_TRANS, etc.)
 */

import { CallExpression, FunctionDeclaration, Node, SourceFile, Statement, SyntaxKind } from "ts-morph";
import { TDConstructType, TDPatchOp, type TDScript, type TDConstruct } from "./types";
import type { VarsContext } from "../../common/transpiler-utils";
import { evaluateExpression } from "./parse-helpers";
import { expressionToTrigger } from "./expression-eval";
import { type FuncsContext } from "./state-transitions";
import { resolveTransitiveStates, collectOrphanWarnings } from "./state-resolution";
import {
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
} from "./patch-operations";
import { transformChainCall } from "./parse-chain";
import {
    transformBegin,
    transformAppend,
    transformReplaceState,
    transformExtend,
    transformInterject,
} from "./parse-constructs";

/** TD function/keyword constants */
const TD_KEYWORDS = {
    BEGIN: "begin",
    CHAIN: "chain",
    APPEND: "append",
    APPEND_EARLY: "appendEarly",
    REPLACE_STATE: "replaceState",
    EXTEND_TOP: "extendTop",
    EXTEND_BOTTOM: "extendBottom",
    INTERJECT: "interject",
    INTERJECT_COPY_TRANS: "interjectCopyTrans",
    INTERJECT_COPY_TRANS2: "interjectCopyTrans2",
    ALTER_TRANS: "alterTrans",
    REPLACE: "replace",
    ADD_STATE_TRIGGER: "addStateTrigger",
    ADD_TRANS_TRIGGER: "addTransTrigger",
    ADD_TRANS_ACTION: "addTransAction",
    REPLACE_TRANS_TRIGGER: "replaceTransTrigger",
    REPLACE_TRANS_ACTION: "replaceTransAction",
    REPLACE_TRIGGER_TEXT: "replaceTriggerText",
    REPLACE_ACTION_TEXT: "replaceActionText",
    SET_WEIGHT: "setWeight",
    REPLACE_SAY: "replaceSay",
    REPLACE_STATE_TRIGGER: "replaceStateTrigger",
} as const;

/**
 * Per-call parse context. Fresh instance for every parse() invocation — no
 * state is shared across calls.
 *
 * `vars` is intentionally mutable throughout a single pass: inlineUserFunction
 * in state-transitions.ts saves/restores it around each user-function call so
 * that loop-unrolling and parameter substitution work correctly. The mutation
 * is always scoped to the current parse() invocation.
 */
interface ParseContext {
    readonly sourceFile: SourceFile;
    readonly vars: VarsContext; // mutable by design — inlineUserFunction mutates it
    readonly funcs: FuncsContext;
    readonly calledAsFunction: Set<string>;
}

/**
 * Parse a bundled TypeScript source file to TD IR.
 * Each call receives a fresh ParseContext — no state leaks between calls.
 */
export function parse(sourceFile: SourceFile): TDScript {
    const ctx: ParseContext = {
        sourceFile,
        vars: new Map(),
        funcs: new Map(),
        calledAsFunction: new Set(),
    };

    // Pass 1: Collect declarations
    collectDeclarations(ctx);

    // Pass 2: Transform top-level statements to constructs
    const constructs: TDConstruct[] = [];

    for (const stmt of sourceFile.getStatements()) {
        const construct = transformTopLevel(ctx, stmt);
        if (construct) {
            constructs.push(...construct);
        }
    }

    // Pass 3: Transitively collect goTo targets not explicitly listed
    resolveTransitiveStates(constructs, ctx.funcs, ctx.vars);

    // Pass 4: Warn about orphan state functions
    const warnings = collectOrphanWarnings(constructs, ctx.funcs, ctx.calledAsFunction);

    return {
        sourceFile: sourceFile.getFilePath(),
        constructs,
        warnings: warnings.length > 0 ? warnings : undefined,
    };
}

/**
 * Collect variable and function declarations for compile-time evaluation.
 */
function collectDeclarations(ctx: ParseContext): void {
    // Collect all variable declarations
    for (const varDecl of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
        const name = varDecl.getName();
        const init = varDecl.getInitializer();
        if (init) {
            const value = evaluateExpression(init, ctx.vars);
            if (value !== undefined) {
                ctx.vars.set(name, value);
            }
        }
    }

    // Collect function declarations (including those inside if statements)
    for (const func of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)) {
        const name = func.getName();
        if (name) {
            // Check if function is inside an if statement (entry trigger)
            const trigger = getFunctionEntryTrigger(ctx, func);
            ctx.funcs.set(name, { func, trigger });
        }
    }

    // Identify functions used as direct callees (helper functions, not states).
    // e.g. helper() -> "helper" is callee, so it's a helper function.
    // goTo(myState) -> "goTo" is callee, "myState" is an argument, not added.
    for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const callee = call.getExpression();
        if (Node.isIdentifier(callee)) {
            const name = callee.getText();
            if (ctx.funcs.has(name)) {
                ctx.calledAsFunction.add(name);
            }
        }
    }
}

/**
 * Check if a function is inside an if statement and return its trigger.
 * Pattern: if (trigger()) { function name() { ... } }
 */
function getFunctionEntryTrigger(ctx: ParseContext, func: FunctionDeclaration): string | undefined {
    const parent = func.getParent();

    // Check if parent is a Block inside an IfStatement
    if (Node.isBlock(parent)) {
        const blockParent = parent.getParent();
        if (Node.isIfStatement(blockParent)) {
            // This function is the "then" branch of an if
            return expressionToTrigger(blockParent.getExpression(), ctx.vars);
        }
    }

    return undefined;
}

/**
 * Transform a top-level statement to TD constructs.
 */
function transformTopLevel(ctx: ParseContext, stmt: Statement): TDConstruct[] | null {
    // Skip variable and function declarations
    if (stmt.isKind(SyntaxKind.VariableStatement) || stmt.isKind(SyntaxKind.FunctionDeclaration)) {
        return null;
    }

    // Skip if-wrapped functions - they're processed when referenced in dialog()/append()
    // The if-wrapper just provides the entry trigger, which is captured during collection
    if (stmt.isKind(SyntaxKind.IfStatement)) {
        return null;
    }

    // Handle expression statement (top-level calls like dialog(), append(), etc.)
    if (stmt.isKind(SyntaxKind.ExpressionStatement)) {
        const expr = stmt.getExpression();
        if (Node.isCallExpression(expr)) {
            return transformTopLevelCall(ctx, expr);
        }
    }

    // Handle export default (for dialog())
    if (stmt.isKind(SyntaxKind.ExportAssignment)) {
        const expr = stmt.getExpression();
        if (Node.isCallExpression(expr)) {
            return transformTopLevelCall(ctx, expr);
        }
    }

    return null;
}

/**
 * Transform a top-level call expression.
 */
function transformTopLevelCall(ctx: ParseContext, call: CallExpression): TDConstruct[] | null {
    const funcName = call.getExpression().getText();

    switch (funcName) {
        case TD_KEYWORDS.BEGIN:
            return transformBegin(ctx, call);
        case TD_KEYWORDS.CHAIN:
            return transformChainCall(ctx, call);
        case TD_KEYWORDS.APPEND:
            return transformAppend(ctx, call, false);
        case TD_KEYWORDS.APPEND_EARLY:
            return transformAppend(ctx, call, true);
        case TD_KEYWORDS.REPLACE_STATE:
            return transformReplaceState(ctx, call);
        case TD_KEYWORDS.EXTEND_TOP:
        case TD_KEYWORDS.EXTEND_BOTTOM:
            return transformExtend(ctx, call, funcName === TD_KEYWORDS.EXTEND_TOP);
        case TD_KEYWORDS.INTERJECT:
            return transformInterject(ctx, call, TDConstructType.Interject);
        case TD_KEYWORDS.INTERJECT_COPY_TRANS:
            return transformInterject(ctx, call, TDConstructType.InterjectCopyTrans);
        case TD_KEYWORDS.INTERJECT_COPY_TRANS2:
            return transformInterject(ctx, call, TDConstructType.InterjectCopyTrans2);
        case TD_KEYWORDS.REPLACE:
            return transformReplace(call, ctx.vars, ctx.funcs);
        case TD_KEYWORDS.ALTER_TRANS:
            return transformAlterTrans(call, ctx.vars);
        case TD_KEYWORDS.ADD_STATE_TRIGGER:
            return transformAddStateTrigger(call, ctx.vars);
        case TD_KEYWORDS.ADD_TRANS_TRIGGER:
            return transformAddTransTrigger(call, ctx.vars);
        case TD_KEYWORDS.ADD_TRANS_ACTION:
            return transformAddTransAction(call, ctx.vars);
        case TD_KEYWORDS.REPLACE_TRANS_TRIGGER:
            return transformReplaceTrans(call, TDPatchOp.ReplaceTransTrigger, ctx.vars);
        case TD_KEYWORDS.REPLACE_TRANS_ACTION:
            return transformReplaceTrans(call, TDPatchOp.ReplaceTransAction, ctx.vars);
        case TD_KEYWORDS.REPLACE_TRIGGER_TEXT:
            return transformReplaceText(call, TDPatchOp.ReplaceTriggerText, ctx.vars);
        case TD_KEYWORDS.REPLACE_ACTION_TEXT:
            return transformReplaceText(call, TDPatchOp.ReplaceActionText, ctx.vars);
        case TD_KEYWORDS.SET_WEIGHT:
            return transformSetWeight(call, ctx.vars);
        case TD_KEYWORDS.REPLACE_SAY:
            return transformReplaceSay(call, ctx.vars);
        case TD_KEYWORDS.REPLACE_STATE_TRIGGER:
            return transformReplaceStateTrigger(call, ctx.vars);
        default:
            return null;
    }
}
