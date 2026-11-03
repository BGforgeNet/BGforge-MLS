/**
 * TD Parser - converts TypeScript AST to TD IR
 *
 * Walks the TypeScript AST (via ts-morph) and produces TDScript IR
 * for emission to WeiDU D format. Every compile-time value goes through the
 * evaluator (`common/compile-time-eval.ts`) in the scope that reads it.
 *
 * Implementation is split across modules:
 * - parse-helpers.ts: the values constructs read (names, labels, numbers, lists, options, actions)
 * - expression-eval.ts: triggers and dialog text
 * - parse-chain.ts: chain() top-level call transforms (transformChainCall)
 * - parse-constructs.ts: begin/append/extend/interject/replaceState transforms
 * - chain-parsing.ts: method chain transition parsing (reply().action().goTo())
 * - chain-processing.ts: chain body processing (from/fromWhen/say)
 * - state-transitions.ts: state/transition/extend processing, helper inlining
 * - state-resolution.ts: transitive state collection and orphan detection
 * - patch-operations.ts: patch operation transforms (ALTER_TRANS, etc.)
 */

import {
    type CallExpression,
    type IfStatement,
    type SourceFile,
    type Statement,
    type VariableStatement,
    Node,
    SyntaxKind,
} from "ts-morph";
import { TDConstructType, TDPatchOp, type TDScript, type TDConstruct } from "./types";
import { Scope, declareStatements } from "../../common/compile-time-eval";
import { getBlockStatements } from "../../common/transpiler-utils";
import { TranspileError } from "../../common/transpile-error";
import { blockScope, isDeclaration, unrollLoop } from "./parse-helpers";
import { STATE_ENTRY, requiredTriggerOf } from "./expression-eval";
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
    type ConstructContext,
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

/** Calls esbuild inserts into a bundle for its own bookkeeping; none of them is a TD construct. */
const BUNDLER_HELPERS: ReadonlySet<string> = new Set(["__name", "__defProp"]);

/**
 * Per-call parse context. Fresh instance for every parse() invocation - no
 * state is shared across calls.
 */
interface ParseContext {
    readonly sourceFile: SourceFile;
    readonly funcs: FuncsContext;
    readonly calledAsFunction: Set<string>;
    /** Local names the file exports as `default` through an export list (see `defaultExportedCall`). */
    readonly defaultExports: ReadonlySet<string>;
}

/**
 * Parse a bundled TypeScript source file to TD IR.
 * Each call receives a fresh ParseContext - no state leaks between calls.
 */
export function parse(sourceFile: SourceFile): TDScript {
    const scope = new Scope();
    const statements = sourceFile.getStatements();
    declareStatements(scope, statements);

    const funcs = collectFunctions(sourceFile, scope);
    const ctx: ParseContext = {
        sourceFile,
        funcs,
        calledAsFunction: collectCalledFunctions(sourceFile, funcs),
        defaultExports: collectDefaultExportNames(sourceFile),
    };

    // Transform top-level statements to constructs
    const constructs = statements.flatMap((stmt) => transformTopLevel(ctx, stmt, scope));

    // Transitively collect goTo targets not explicitly listed
    resolveTransitiveStates(constructs, ctx.funcs);

    // Warn about orphan state functions
    const warnings = collectOrphanWarnings(constructs, ctx.funcs, ctx.calledAsFunction);

    return {
        sourceFile: sourceFile.getFilePath(),
        constructs,
        warnings: warnings.length > 0 ? warnings : undefined,
    };
}

/**
 * Every function the source declares, by name, for collecting states a construct or a goTo() names. A
 * module-level function closes over the module scope; one inside a module-level `if` over that block, and takes
 * the if's condition as its state entry trigger.
 */
function collectFunctions(sourceFile: SourceFile, scope: Scope): FuncsContext {
    const funcs: FuncsContext = new Map();
    for (const func of sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)) {
        const name = func.getName();
        // A body-less `declare function` stands in for the bodied one, wherever either sits.
        if (name && (!funcs.has(name) || func.getBody() !== undefined)) {
            funcs.set(name, { func, closure: func.getParent() === sourceFile ? scope : undefined });
        }
    }
    for (const stmt of sourceFile.getStatements()) {
        if (!Node.isIfStatement(stmt)) continue;
        const thenStmts = getBlockStatements(stmt.getThenStatement());
        const wrapped = thenStmts.filter((s) => Node.isFunctionDeclaration(s));
        if (wrapped.length === 0) continue;
        const trigger = requiredTriggerOf(stmt.getExpression(), scope, STATE_ENTRY);
        const closure = blockScope(scope, thenStmts);
        for (const func of wrapped) {
            const name = func.getName();
            if (name && func.getBody() !== undefined) funcs.set(name, { func, closure, trigger });
        }
    }
    return funcs;
}

/**
 * Names used as direct callees (helper functions, not states).
 * e.g. helper() -> "helper" is callee, so it's a helper function.
 * goTo(myState) -> "goTo" is callee, "myState" is an argument, not added.
 */
function collectCalledFunctions(sourceFile: SourceFile, funcs: FuncsContext): Set<string> {
    const called = new Set<string>();
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const callee = call.getExpression();
        if (Node.isIdentifier(callee) && funcs.has(callee.getText())) called.add(callee.getText());
    }
    return called;
}

/**
 * Transform a top-level statement to TD constructs.
 */
function transformTopLevel(ctx: ParseContext, stmt: Statement, scope: Scope): TDConstruct[] {
    // Declarations emit nothing - except a binding the file exports as default
    if (stmt.isKind(SyntaxKind.VariableStatement)) {
        const call = defaultExportedCall(ctx, stmt);
        return call ? (transformTopLevelCall(ctx, call, scope) ?? []) : [];
    }
    if (isDeclaration(stmt) || stmt.isKind(SyntaxKind.ExportDeclaration)) {
        return [];
    }

    // An if-wrapped function is processed when a construct references it; the if gives it
    // its entry trigger (see collectFunctions).
    if (stmt.isKind(SyntaxKind.IfStatement)) {
        checkStateWrapper(stmt);
        return [];
    }

    // Handle expression statement (top-level calls like dialog(), append(), etc.)
    // and export default (for dialog())
    if (stmt.isKind(SyntaxKind.ExpressionStatement) || stmt.isKind(SyntaxKind.ExportAssignment)) {
        const expr = stmt.getExpression();
        if (!Node.isCallExpression(expr)) {
            throw TranspileError.fromNode(stmt, `${expr.getKindName()} is not a TD construct`);
        }
        if (BUNDLER_HELPERS.has(expr.getExpression().getText())) return [];
        return transformTopLevelCall(ctx, expr, scope) ?? [];
    }

    if (stmt.isKind(SyntaxKind.ForStatement) || stmt.isKind(SyntaxKind.ForOfStatement)) {
        const constructs: TDConstruct[] = [];
        unrollLoop(stmt, scope, (body, iteration) => {
            for (const s of body) constructs.push(...transformTopLevel(ctx, s, iteration));
        });
        return constructs;
    }
    if (stmt.isKind(SyntaxKind.Block)) {
        const inner = blockScope(scope, stmt.getStatements());
        return stmt.getStatements().flatMap((s) => transformTopLevel(ctx, s, inner));
    }

    throw TranspileError.fromNode(stmt, `${stmt.getKindName()} is not supported at the top level of a TD file`);
}

/** A module-level `if` wraps state functions only, giving them its condition as their entry trigger. */
function checkStateWrapper(stmt: IfStatement): void {
    if (stmt.getElseStatement() !== undefined) {
        throw TranspileError.fromNode(stmt, "a module-level if wraps state functions, and takes no else");
    }
    for (const s of getBlockStatements(stmt.getThenStatement())) {
        if (!isDeclaration(s)) {
            throw TranspileError.fromNode(
                s,
                `a module-level if wraps state functions, giving them its trigger; ${s.getKindName()} is not supported in it`,
            );
        }
    }
}

/**
 * Local names exported as `default` through an export list, re-exports from another module excluded.
 */
function collectDefaultExportNames(sourceFile: SourceFile): Set<string> {
    const names = new Set<string>();
    for (const decl of sourceFile.getExportDeclarations()) {
        if (decl.getModuleSpecifier()) continue;
        for (const spec of decl.getNamedExports()) {
            if (spec.getAliasNode()?.getText() === "default") names.add(spec.getName());
        }
    }
    return names;
}

/**
 * The call a variable statement binds to the file's default export, if it does.
 *
 * Bundling rewrites the entry's `export default begin(...)` as `var x_default = begin(...)` plus
 * `export { x_default as default }`, so this is the same construct the ExportAssignment branch reads unbundled.
 */
function defaultExportedCall(ctx: ParseContext, stmt: VariableStatement): CallExpression | undefined {
    const declarations = stmt.getDeclarations();
    const decl = declarations[0];
    if (declarations.length !== 1 || decl === undefined || !ctx.defaultExports.has(decl.getName())) return undefined;
    const init = decl.getInitializer();
    return init && Node.isCallExpression(init) ? init : undefined;
}

/**
 * Transform a top-level call expression.
 */
function transformTopLevelCall(ctx: ParseContext, call: CallExpression, scope: Scope): TDConstruct[] | null {
    const funcName = call.getExpression().getText();
    const constructCtx: ConstructContext = { funcs: ctx.funcs, scope };

    switch (funcName) {
        case TD_KEYWORDS.BEGIN:
            return transformBegin(constructCtx, call);
        case TD_KEYWORDS.CHAIN:
            return transformChainCall(call, scope);
        case TD_KEYWORDS.APPEND:
            return transformAppend(constructCtx, call, false);
        case TD_KEYWORDS.APPEND_EARLY:
            return transformAppend(constructCtx, call, true);
        case TD_KEYWORDS.REPLACE_STATE:
            return transformReplaceState(constructCtx, call);
        case TD_KEYWORDS.EXTEND_TOP:
        case TD_KEYWORDS.EXTEND_BOTTOM:
            return transformExtend(constructCtx, call, funcName === TD_KEYWORDS.EXTEND_TOP);
        case TD_KEYWORDS.INTERJECT:
            return transformInterject(constructCtx, call, TDConstructType.Interject);
        case TD_KEYWORDS.INTERJECT_COPY_TRANS:
            return transformInterject(constructCtx, call, TDConstructType.InterjectCopyTrans);
        case TD_KEYWORDS.INTERJECT_COPY_TRANS2:
            return transformInterject(constructCtx, call, TDConstructType.InterjectCopyTrans2);
        case TD_KEYWORDS.REPLACE:
            return transformReplace(call, scope, ctx.funcs);
        case TD_KEYWORDS.ALTER_TRANS:
            return transformAlterTrans(call, scope);
        case TD_KEYWORDS.ADD_STATE_TRIGGER:
            return transformAddStateTrigger(call, scope);
        case TD_KEYWORDS.ADD_TRANS_TRIGGER:
            return transformAddTransTrigger(call, scope);
        case TD_KEYWORDS.ADD_TRANS_ACTION:
            return transformAddTransAction(call, scope);
        case TD_KEYWORDS.REPLACE_TRANS_TRIGGER:
            return transformReplaceTrans(call, TDPatchOp.ReplaceTransTrigger, scope);
        case TD_KEYWORDS.REPLACE_TRANS_ACTION:
            return transformReplaceTrans(call, TDPatchOp.ReplaceTransAction, scope);
        case TD_KEYWORDS.REPLACE_TRIGGER_TEXT:
            return transformReplaceText(call, TDPatchOp.ReplaceTriggerText, scope);
        case TD_KEYWORDS.REPLACE_ACTION_TEXT:
            return transformReplaceText(call, TDPatchOp.ReplaceActionText, scope);
        case TD_KEYWORDS.SET_WEIGHT:
            return transformSetWeight(call, scope);
        case TD_KEYWORDS.REPLACE_SAY:
            return transformReplaceSay(call, scope);
        case TD_KEYWORDS.REPLACE_STATE_TRIGGER:
            return transformReplaceStateTrigger(call, scope);
        default:
            throw TranspileError.fromNode(call, `'${funcName}()' is not a TD construct`);
    }
}
