/**
 * Loop unrolling for TBAF transformer.
 *
 * Unrolls for and for-of loops at compile time, since BAF has no loop constructs.
 * Supports array destructuring, nested arrays, and variable substitution.
 */

import { ForOfStatement, ForStatement, SyntaxKind } from "ts-morph";
import type { BAFAction } from "./ir";
import * as utils from "../../common/transpiler-utils";
import type { TransformerContext } from "./transformer-context";
import { TranspileError } from "../../common/transpile-error";

/**
 * Unroll a for-of loop, calling the callback for each element.
 * Sets the loop variable in vars context during each iteration.
 * Supports array destructuring: for (const [a, b, c] of array)
 */
function unrollForOf(ctx: TransformerContext, forOf: ForOfStatement, onIteration: () => void): void {
    const arrayExpr = forOf.getExpression();
    const elements = ctx.resolveArrayElements(arrayExpr);

    if (!elements) {
        throw TranspileError.fromNode(
            arrayExpr,
            `Cannot unroll for-of: array expression "${arrayExpr.getText()}" is not resolvable`,
        );
    }

    const initializer = forOf.getInitializer();

    // Check for array destructuring pattern: const [a, b, c] of array
    const bindingPattern = initializer.getDescendantsOfKind(SyntaxKind.ArrayBindingPattern)[0];

    if (bindingPattern) {
        // Destructuring: extract binding element names
        const bindingNames = utils.getBindingNames(bindingPattern);

        for (const element of elements) {
            const values = utils.parseArrayLiteral(element);
            if (!values) {
                throw new TranspileError(`Cannot destructure "${element}" - not a valid array literal`);
            }

            // Set each destructured variable
            for (let i = 0; i < bindingNames.length; i++) {
                const name = bindingNames[i];
                if (name) {
                    ctx.vars.set(name, values[i] ?? "undefined");
                }
            }

            onIteration();
        }

        // Clean up all destructured variables
        for (const name of bindingNames) {
            if (name) {
                ctx.vars.delete(name);
            }
        }
    } else {
        // Simple variable: const item of array
        const loopVar = initializer
            .getText()
            .replace(/^const\s+/, "")
            .replace(/^let\s+/, "");

        for (const element of elements) {
            ctx.vars.set(loopVar, element);
            onIteration();
        }

        ctx.vars.delete(loopVar);
    }
}

/**
 * Unroll a for loop, calling the callback for each iteration.
 * Sets the loop variable in vars context during each iteration.
 */
function unrollFor(ctx: TransformerContext, forStmt: ForStatement, onIteration: () => void): void {
    const initializer = forStmt.getInitializer();
    if (!initializer || !initializer.isKind(SyntaxKind.VariableDeclarationList)) {
        throw new TranspileError("Cannot unroll for loop: complex initializer");
    }

    const decls = initializer.getDeclarations();
    if (decls.length !== 1) {
        throw new TranspileError("Cannot unroll for loop: multi-variable initializer");
    }

    const firstDecl = decls[0];
    if (!firstDecl) {
        throw new TranspileError("Cannot unroll for loop: no declarations");
    }
    const loopVar = firstDecl.getName();
    const initValue = utils.evaluateNumeric(firstDecl.getInitializer(), ctx.vars);
    if (initValue === undefined) {
        throw new TranspileError("Cannot unroll for loop: non-numeric initializer");
    }

    const condition = forStmt.getCondition();
    if (!condition) {
        throw new TranspileError("Cannot unroll for loop: no condition");
    }

    const incrementor = forStmt.getIncrementor();
    if (!incrementor) {
        throw new TranspileError("Cannot unroll for loop: no incrementor");
    }

    const increment = utils.parseIncrement(incrementor.getText());
    let current = initValue;
    let iterations = 0;

    while (utils.evaluateCondition(condition.getText(), loopVar, current, ctx.vars)) {
        if (iterations >= utils.MAX_LOOP_ITERATIONS) {
            throw new TranspileError(
                `Loop exceeded maximum ${utils.MAX_LOOP_ITERATIONS} iterations. ` +
                    `This likely indicates an infinite loop or a design issue. ` +
                    `BAF scripts should not need many iterations.`,
            );
        }
        ctx.vars.set(loopVar, current.toString());
        onIteration();
        current += increment;
        iterations++;
    }

    ctx.vars.delete(loopVar);
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
