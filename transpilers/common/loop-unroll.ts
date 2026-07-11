/**
 * Shared compile-time for/for-of loop unrolling core, used by TBAF
 * (tbaf/src/loop-unroll.ts) and TD (td/src/inline-and-unroll.ts).
 *
 * Both transpilers unroll for and for-of loops at compile time, since their
 * target formats (BAF, D) have no loop constructs. The two algorithms are
 * otherwise identical; they differ only in:
 *   - how compile-time variables are threaded in (TBAF reads/writes
 *     `TransformerContext.vars`; TD threads a `VarsContext` map directly) -
 *     both are the same `VarsContext` type, so this core just takes it as a
 *     plain parameter.
 *   - how a for-of array expression resolves to elements, and the wording of
 *     the error when it doesn't - left to the caller via
 *     `ResolveArrayElements`, which is expected to throw its own
 *     `TranspileError` on failure rather than returning null, so this core
 *     stays agnostic to that message text.
 *   - how each iteration's body statements are consumed (TBAF transforms the
 *     whole body to actions once per iteration; TD walks the body statement
 *     by statement) - left to the caller via `onIteration`.
 */

import { type Expression, type ForOfStatement, type ForStatement, SyntaxKind } from "ts-morph";
import * as utils from "./transpiler-utils";
import type { VarsContext } from "./transpiler-utils";
import { TranspileError } from "./transpile-error";

/**
 * Resolve a for-of array expression to its compile-time element strings.
 * Implementations throw their own `TranspileError` (with package-specific
 * wording) when the expression cannot be resolved.
 */
export type ResolveArrayElements = (expr: Expression) => string[];

/**
 * Unroll a for-of loop, calling onIteration once per element.
 * Supports array destructuring: for (const [a, b, c] of array)
 */
export function unrollForOfCore(
    vars: VarsContext,
    resolveArrayElements: ResolveArrayElements,
    forOf: ForOfStatement,
    onIteration: () => void,
): void {
    const arrayExpr = forOf.getExpression();
    const elements = resolveArrayElements(arrayExpr);

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
                    vars.set(name, values[i] ?? "undefined");
                }
            }

            onIteration();
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
            onIteration();
        }

        vars.delete(loopVar);
    }
}

/**
 * Unroll a for loop, calling onIteration once per iteration.
 */
export function unrollForCore(vars: VarsContext, forStmt: ForStatement, onIteration: () => void): void {
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
        // Unreachable: decls.length === 1 above guarantees decls[0] exists.
        // Kept only to satisfy noUncheckedIndexedAccess.
        throw new TranspileError("Cannot unroll for loop: no declarations");
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
    let current = initValue;
    let iterations = 0;

    while (utils.evaluateCondition(condition.getText(), loopVar, current, vars)) {
        if (iterations >= utils.MAX_LOOP_ITERATIONS) {
            throw new TranspileError(
                `Loop exceeded maximum ${utils.MAX_LOOP_ITERATIONS} iterations. ` +
                    `This likely indicates an infinite loop or a design issue. ` +
                    `BAF scripts should not need many iterations.`,
            );
        }
        vars.set(loopVar, current.toString());
        onIteration();
        current += increment;
        iterations++;
    }

    vars.delete(loopVar);
}
