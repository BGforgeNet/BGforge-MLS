/**
 * Condition algebra for TBAF transformer.
 *
 * Transforms TypeScript condition expressions into BAF condition IR.
 * Handles &&, ||, !, De Morgan's law, function inlining, and OR groups.
 */

import {
    CallExpression,
    Expression,
    FunctionDeclaration,
    Node,
    PrefixUnaryExpression,
    ReturnStatement,
    SyntaxKind,
} from "ts-morph";
import type { BAFCondition, BAFOrGroup, BAFTopCondition } from "./ir";
import { dnfToCnf } from "./cnf";
import * as utils from "../../common/transpiler-utils";
import type { TransformerContext } from "./transformer-context";
import { TranspileError } from "../../common/transpile-error";

/**
 * Build a condition for a switch case by augmenting the switch expression with the case value.
 * For Global() and similar BAF conditions, appends the value as the last argument.
 */
function buildSwitchCondition(ctx: TransformerContext, switchExpr: Expression, caseValue: string): BAFCondition {
    const substitutedValue = utils.substituteVars(caseValue, ctx.vars);
    const actualExpr = ctx.resolveVariableToExpression(switchExpr);

    if (Node.isCallExpression(actualExpr)) {
        const funcName = actualExpr.getExpression().getText();
        // Get arguments from resolved expression (already contains literal values, not variable names)
        const args = actualExpr.getArguments().map(a => a.getText());

        // For Global and similar functions, append the case value as the last argument
        return {
            negated: false,
            name: funcName,
            args: [...args, substitutedValue],
        };
    }

    throw TranspileError.fromNode(
        switchExpr,
        `Switch expression "${switchExpr.getText()}" is not supported. ` +
        `Only function call expressions (like Global()) are supported in switch statements.`
    );
}

/**
 * Transform a condition expression to BAFTopCondition[].
 * Handles &&, ||, !, and function calls.
 */
function transformConditionExpr(ctx: TransformerContext, expr: Expression): BAFTopCondition[] {
    // Handle binary && - split into multiple top conditions
    if (Node.isBinaryExpression(expr)) {
        const opKind = expr.getOperatorToken().getKind();

        if (opKind === SyntaxKind.AmpersandAmpersandToken) {
            // AND: combine conditions
            return [
                ...transformConditionExpr(ctx, expr.getLeft()),
                ...transformConditionExpr(ctx, expr.getRight()),
            ];
        }

        if (opKind === SyntaxKind.BarBarToken) {
            // OR: create an OR group
            const orGroup = buildOrGroup(ctx, expr);
            return [orGroup];
        }
    }

    // Handle parenthesized expression
    if (Node.isParenthesizedExpression(expr)) {
        return transformConditionExpr(ctx, expr.getExpression());
    }

    // Handle negation
    if (Node.isPrefixUnaryExpression(expr)) {
        const prefixExpr = expr as PrefixUnaryExpression;
        if (prefixExpr.getOperatorToken() === SyntaxKind.ExclamationToken) {
            const operand = prefixExpr.getOperand();
            // Check if it's a negated call
            if (Node.isCallExpression(operand)) {
                const funcName = operand.getExpression().getText();
                const funcDecl = ctx.funcs.get(funcName);

                if (funcDecl) {
                    // User function - negate each inlined condition
                    const conditions = inlineFunctionConditions(ctx, operand, funcDecl);
                    return negateConditions(conditions);
                }

                const cond = ctx.transformCallToCondition(operand);
                return [{ ...cond, negated: true }];
            }
            // Check if it's a negated parenthesized expression with OR
            if (Node.isParenthesizedExpression(operand)) {
                const inner = operand.getExpression();
                if (Node.isBinaryExpression(inner) && inner.getOperatorToken().getKind() === SyntaxKind.BarBarToken) {
                    // !(a || b) → !a && !b - apply De Morgan
                    throw TranspileError.fromNode(
                        inner,
                        `Cannot represent "!(${inner.getText()})" in BAF.\n` +
                        `Negation of OR groups is not supported. Refactor to avoid this pattern.`
                    );
                }
            }
        }
    }

    // Handle call expression
    if (Node.isCallExpression(expr)) {
        const funcName = expr.getExpression().getText();
        const funcDecl = ctx.funcs.get(funcName);

        if (funcDecl) {
            // User-defined function - inline its return expression as conditions
            return inlineFunctionConditions(ctx, expr, funcDecl);
        }

        // Built-in BAF condition
        return [ctx.transformCallToCondition(expr)];
    }

    // Fallback: treat as opaque condition
    return [ctx.opaqueCondition(expr.getText(), false)];
}

/**
 * Build an OR group from a binary || expression.
 */
function buildOrGroup(ctx: TransformerContext, expr: Expression): BAFOrGroup {
    const conditions: BAFCondition[] = [];

    const collect = (e: Expression) => {
        if (Node.isBinaryExpression(e) && e.getOperatorToken().getKind() === SyntaxKind.BarBarToken) {
            collect(e.getLeft());
            collect(e.getRight());
        } else if (Node.isParenthesizedExpression(e)) {
            collect(e.getExpression());
        } else {
            // Must be an atom (call or negated call)
            const cond = exprToCondition(ctx, e);
            conditions.push(cond);
        }
    };

    collect(expr);
    return { conditions };
}

/**
 * Convert an expression to a single BAFCondition (used for OR group elements).
 */
function exprToCondition(ctx: TransformerContext, expr: Expression): BAFCondition {
    if (Node.isPrefixUnaryExpression(expr)) {
        const prefixExpr = expr as PrefixUnaryExpression;
        if (prefixExpr.getOperatorToken() === SyntaxKind.ExclamationToken) {
            const operand = prefixExpr.getOperand();
            if (Node.isCallExpression(operand)) {
                const funcName = operand.getExpression().getText();
                const funcDecl = ctx.funcs.get(funcName);

                if (funcDecl) {
                    const cond = inlineFunctionAsSingleCondition(ctx, operand, funcDecl);
                    return { ...cond, negated: !cond.negated };
                }

                const cond = ctx.transformCallToCondition(operand);
                return { ...cond, negated: true };
            }
        }
    }

    if (Node.isCallExpression(expr)) {
        const funcName = expr.getExpression().getText();
        const funcDecl = ctx.funcs.get(funcName);

        if (funcDecl) {
            return inlineFunctionAsSingleCondition(ctx, expr, funcDecl);
        }

        return ctx.transformCallToCondition(expr);
    }

    return ctx.opaqueCondition(expr.getText(), false);
}

/**
 * Inline a user function call, returning its conditions.
 * Handles complex return expressions like "A() && B() && C()".
 */
function inlineFunctionConditions(ctx: TransformerContext, call: CallExpression, funcDecl: FunctionDeclaration): BAFTopCondition[] {
    const body = funcDecl.getBody()?.asKindOrThrow(SyntaxKind.Block);
    if (!body) return [ctx.trueCondition()];

    const returnStmt = body.getStatements().find(s => s.isKind(SyntaxKind.ReturnStatement));
    if (!returnStmt) return [ctx.trueCondition()];

    const returnExpr = (returnStmt as ReturnStatement).getExpression();
    if (!returnExpr) return [ctx.trueCondition()];

    // Substitute params in return expression text
    const paramMap = utils.buildParamMap(call, funcDecl, ctx.vars);
    let returnText = returnExpr.getText();
    paramMap.forEach((value, key) => {
        returnText = returnText.replace(new RegExp(`\\b${key}\\b`, "g"), value);
    });

    // Parse the substituted return expression
    const expr = ctx.parseExpressionFromText(returnText);
    if (!expr) {
        throw new TranspileError("Failed to parse return expression");
    }

    // Transform the parsed expression using the full condition transformer
    return transformConditionExpr(ctx, expr);
}

/**
 * Inline a user function call as a single condition (for OR groups).
 * Throws if the function returns multiple conditions.
 */
function inlineFunctionAsSingleCondition(ctx: TransformerContext, call: CallExpression, funcDecl: FunctionDeclaration): BAFCondition {
    const conditions = inlineFunctionConditions(ctx, call, funcDecl);

    if (conditions.length !== 1) {
        throw new TranspileError(
            `Cannot use function "${funcDecl.getName()}" inside OR group: ` +
            `it returns ${conditions.length} conditions, but OR elements must be single conditions.`
        );
    }

    const cond = conditions[0];
    if (!cond) {
        throw new TranspileError(`Function "${funcDecl.getName()}" returned no conditions`);
    }
    if ("conditions" in cond) {
        throw new TranspileError(
            `Cannot use function "${funcDecl.getName()}" inside OR group: ` +
            `it returns an OR group, which cannot be nested inside another OR.`
        );
    }

    return cond;
}

/**
 * Invert conditions for else block.
 */
function invertConditions(ctx: TransformerContext, parentConditions: BAFTopCondition[], condExpr: Expression): BAFTopCondition[] {
    // For else, we need: parentConditions AND NOT(condExpr)
    const inverted = invertExpression(ctx, condExpr);
    return [...parentConditions, ...inverted];
}

/**
 * Invert an expression using De Morgan's law.
 * Returns BAFTopCondition[] since inversion of AND produces OR.
 */
function invertExpression(ctx: TransformerContext, expr: Expression): BAFTopCondition[] {
    if (Node.isBinaryExpression(expr)) {
        const opKind = expr.getOperatorToken().getKind();

        if (opKind === SyntaxKind.AmpersandAmpersandToken) {
            // !(a && b) → !a || !b
            // Each inverted operand may be a conjunction (multiple ANDed conditions).
            // We need to OR these conjunctions, which produces DNF.
            // Convert DNF to CNF using the distributive law.
            const leftConds = invertExpression(ctx, expr.getLeft());
            const rightConds = invertExpression(ctx, expr.getRight());

            // If both results are single atoms, we can directly create an OR group
            const leftFirst = leftConds[0];
            const rightFirst = rightConds[0];
            if (leftConds.length === 1 && rightConds.length === 1 &&
                leftFirst && rightFirst &&
                !("conditions" in leftFirst) && !("conditions" in rightFirst)) {
                return [{ conditions: [leftFirst, rightFirst] }];
            }

            // Otherwise, use DNF→CNF conversion
            return dnfToCnf([leftConds, rightConds]);
        }

        if (opKind === SyntaxKind.BarBarToken) {
            // !(a || b) → !a && !b - produces multiple ANDed conditions
            const leftConds = invertExpression(ctx, expr.getLeft());
            const rightConds = invertExpression(ctx, expr.getRight());
            return [...leftConds, ...rightConds];
        }
    }

    if (Node.isParenthesizedExpression(expr)) {
        return invertExpression(ctx, expr.getExpression());
    }

    if (Node.isPrefixUnaryExpression(expr)) {
        const prefixExpr = expr as PrefixUnaryExpression;
        if (prefixExpr.getOperatorToken() === SyntaxKind.ExclamationToken) {
            // !!a → a (double negation)
            const operand = prefixExpr.getOperand();
            if (Node.isCallExpression(operand)) {
                const funcName = operand.getExpression().getText();
                const funcDecl = ctx.funcs.get(funcName);

                if (funcDecl) {
                    // Un-negate user function conditions
                    return inlineFunctionConditions(ctx, operand, funcDecl);
                }

                const cond = ctx.transformCallToCondition(operand);
                return [{ ...cond, negated: false }];
            }
            return transformConditionExpr(ctx, operand);
        }
    }

    if (Node.isCallExpression(expr)) {
        const funcName = expr.getExpression().getText();
        const funcDecl = ctx.funcs.get(funcName);

        if (funcDecl) {
            // Negate each condition from the user function
            const conditions = inlineFunctionConditions(ctx, expr, funcDecl);
            return negateConditions(conditions);
        }

        const cond = ctx.transformCallToCondition(expr);
        return [{ ...cond, negated: true }];
    }

    return [ctx.opaqueCondition(expr.getText(), true)];
}

/**
 * Negate a CNF expression using De Morgan's law.
 *
 * Input: [C1, C2, ...] meaning C1 && C2 && ...
 * Output: CNF for !(C1 && C2 && ...) = !C1 || !C2 || ...
 *
 * Each !Ci:
 * - If Ci is atom A: !Ci = !A
 * - If Ci is OR(A,B,...): !Ci = !A && !B && ... (conjunction)
 *
 * Result is DNF (OR of conjunctions), converted to CNF.
 */
function negateConditions(conditions: BAFTopCondition[]): BAFTopCondition[] {
    // Build DNF terms: each term is a conjunction (negated Ci)
    const terms: BAFTopCondition[][] = [];

    for (const c of conditions) {
        if ("conditions" in c) {
            // OR group: !(A || B || ...) = !A && !B && ... (De Morgan)
            const negatedAtoms: BAFCondition[] = c.conditions.map(
                inner => ({ ...inner, negated: !inner.negated })
            );
            terms.push(negatedAtoms);
        } else {
            // Atom: just negate it
            terms.push([{ ...c, negated: !c.negated }]);
        }
    }

    // Convert DNF (OR of terms) to CNF
    return dnfToCnf(terms);
}

export {
    buildSwitchCondition,
    transformConditionExpr,
    invertConditions,
};
