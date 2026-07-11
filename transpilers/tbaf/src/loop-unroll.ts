/**
 * Loop unrolling for TBAF transformer.
 *
 * Thin TBAF-specific wrapper around the shared unroll core in
 * transpilers/common/loop-unroll.ts: threads TransformerContext.vars through,
 * resolves for-of arrays via ctx.resolveArrayElements(), and transforms each
 * iteration's body statements to BAFActions.
 */

import { type Expression, type ForOfStatement, type ForStatement } from "ts-morph";
import type { BAFAction } from "./ir";
import * as utils from "../../common/transpiler-utils";
import { type ResolveArrayElements, unrollForCore, unrollForOfCore } from "../../common/loop-unroll";
import type { TransformerContext } from "./transformer-context";
import { TranspileError } from "../../common/transpile-error";

/** Build the array-element resolver the shared core calls for for-of loops. */
function makeResolveArrayElements(ctx: TransformerContext): ResolveArrayElements {
    return (expr: Expression) => {
        const elements = ctx.resolveArrayElements(expr);
        if (!elements) {
            throw TranspileError.fromNode(
                expr,
                `Cannot unroll for-of: array expression "${expr.getText()}" is not resolvable`,
            );
        }
        return elements;
    };
}

/**
 * Unroll a for-of loop, calling the callback for each element.
 * Sets the loop variable in vars context during each iteration.
 * Supports array destructuring: for (const [a, b, c] of array)
 */
function unrollForOf(ctx: TransformerContext, forOf: ForOfStatement, onIteration: () => void): void {
    unrollForOfCore(ctx.vars, makeResolveArrayElements(ctx), forOf, onIteration);
}

/**
 * Unroll a for loop, calling the callback for each iteration.
 * Sets the loop variable in vars context during each iteration.
 */
function unrollFor(ctx: TransformerContext, forStmt: ForStatement, onIteration: () => void): void {
    unrollForCore(ctx.vars, forStmt, onIteration);
}

/**
 * Unroll a for-of loop into actions.
 */
function unrollForOfAsActions(ctx: TransformerContext, forOf: ForOfStatement): BAFAction[] {
    const bodyStatements = utils.getBlockStatements(forOf.getStatement());
    const actions: BAFAction[] = [];
    unrollForOf(ctx, forOf, () => {
        actions.push(...ctx.transformActionsFromStatements(bodyStatements));
    });
    return actions;
}

/**
 * Unroll a for loop into actions.
 */
function unrollForAsActions(ctx: TransformerContext, forStmt: ForStatement): BAFAction[] {
    const bodyStatements = utils.getBlockStatements(forStmt.getStatement());
    const actions: BAFAction[] = [];
    unrollFor(ctx, forStmt, () => {
        actions.push(...ctx.transformActionsFromStatements(bodyStatements));
    });
    return actions;
}

export { unrollForOf, unrollFor, unrollForOfAsActions, unrollForAsActions };
