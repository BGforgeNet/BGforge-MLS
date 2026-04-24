/**
 * TD loop unrolling - compile-time unrolling of for-of and for loops
 * inside TD state functions and extend blocks.
 *
 * Extracted from state-transitions.ts. These functions accept a callback
 * for statement processing so they remain decoupled from state-transitions.ts.
 */

import { ForOfStatement, ForStatement, Statement, SyntaxKind } from "ts-morph";
import type { VarsContext } from "../../common/transpiler-utils";
import * as utils from "../../common/transpiler-utils";
import { resolveArrayElements } from "./parse-helpers";
import { TranspileError } from "../../common/transpile-error";

/**
 * Unroll a for-of loop.
 * Supports both simple variables and array destructuring patterns.
 */
export function unrollForOf(forOf: ForOfStatement, vars: VarsContext, onStatement: (s: Statement) => void): void {
    const arrayExpr = forOf.getExpression();
    const elements = resolveArrayElements(arrayExpr, vars);

    if (!elements) {
        throw TranspileError.fromNode(arrayExpr, `Cannot unroll for-of: array "${arrayExpr.getText()}" not resolvable`);
    }

    const initializer = forOf.getInitializer();
    const bodyStmts = utils.getBlockStatements(forOf.getStatement());

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
                    vars.set(name, values[i] ?? "undefined");
                }
            }

            for (const stmt of bodyStmts) {
                onStatement(stmt);
            }
        }

        // Clean up all destructured variables
        for (const name of bindingNames) {
            if (name) {
                vars.delete(name);
            }
        }
    } else {
        // Simple variable: const item of array
        const loopVar = initializer
            .getText()
            .replace(/^const\s+/, "")
            .replace(/^let\s+/, "");

        for (const element of elements) {
            vars.set(loopVar, element);
            for (const stmt of bodyStmts) {
                onStatement(stmt);
            }
        }

        vars.delete(loopVar);
    }
}

/**
 * Unroll a for loop.
 */
export function unrollFor(forStmt: ForStatement, vars: VarsContext, onStatement: (s: Statement) => void): void {
    const initializer = forStmt.getInitializer();
    if (!initializer || !initializer.isKind(SyntaxKind.VariableDeclarationList)) {
        throw new TranspileError("Cannot unroll for loop: complex initializer");
    }

    const decls = initializer.getDeclarations();
    const firstDecl = decls[0];
    if (!firstDecl) {
        throw new TranspileError("Cannot unroll for loop: no variable declaration");
    }

    const loopVar = firstDecl.getName();
    const initValue = utils.evaluateNumeric(firstDecl.getInitializer(), vars);
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
    const bodyStmts = utils.getBlockStatements(forStmt.getStatement());

    let current = initValue;
    let iterations = 0;

    while (utils.evaluateCondition(condition.getText(), loopVar, current, vars)) {
        if (iterations >= utils.MAX_LOOP_ITERATIONS) {
            throw new TranspileError(`Loop exceeded ${utils.MAX_LOOP_ITERATIONS} iterations`);
        }

        vars.set(loopVar, current.toString());
        for (const stmt of bodyStmts) {
            onStatement(stmt);
        }

        current += increment;
        iterations++;
    }

    vars.delete(loopVar);
}
