/**
 * TD loop unrolling - compile-time unrolling of for-of and for loops
 * inside TD state functions and extend blocks.
 *
 * Extracted from state-transitions.ts. These functions accept a callback
 * for statement processing so they remain decoupled from state-transitions.ts.
 *
 * Thin TD-specific wrapper around the shared unroll core in
 * transpilers/common/loop-unroll.ts: threads a VarsContext map through,
 * resolves for-of arrays via parse-helpers' resolveArrayElements(), and
 * walks each iteration's body statement by statement via onStatement.
 */

import { type Expression, type ForOfStatement, type ForStatement, type Statement } from "ts-morph";
import type { VarsContext } from "../../common/transpiler-utils";
import * as utils from "../../common/transpiler-utils";
import { type ResolveArrayElements, unrollForCore, unrollForOfCore } from "../../common/loop-unroll";
import { resolveArrayElements as resolveArrayElementsRaw } from "./parse-helpers";
import { TranspileError } from "../../common/transpile-error";

/** Build the array-element resolver the shared core calls for for-of loops. */
function makeResolveArrayElements(vars: VarsContext): ResolveArrayElements {
    return (expr: Expression) => {
        const elements = resolveArrayElementsRaw(expr, vars);
        if (!elements) {
            throw TranspileError.fromNode(expr, `Cannot unroll for-of: array "${expr.getText()}" not resolvable`);
        }
        return elements;
    };
}

/**
 * Unroll a for-of loop.
 * Supports both simple variables and array destructuring patterns.
 */
export function unrollForOf(forOf: ForOfStatement, vars: VarsContext, onStatement: (s: Statement) => void): void {
    const bodyStmts = utils.getBlockStatements(forOf.getStatement());
    unrollForOfCore(vars, makeResolveArrayElements(vars), forOf, () => {
        for (const stmt of bodyStmts) {
            onStatement(stmt);
        }
    });
}

/**
 * Unroll a for loop.
 */
export function unrollFor(forStmt: ForStatement, vars: VarsContext, onStatement: (s: Statement) => void): void {
    const bodyStmts = utils.getBlockStatements(forStmt.getStatement());
    unrollForCore(vars, forStmt, () => {
        for (const stmt of bodyStmts) {
            onStatement(stmt);
        }
    });
}
