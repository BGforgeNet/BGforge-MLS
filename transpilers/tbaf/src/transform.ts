/**
 * TBAF Transformer
 *
 * Single-pass AST to BAF IR transformer.
 * Delegates condition algebra to condition-algebra.ts and loop unrolling to loop-unroll.ts.
 */

import {
    ArrayLiteralExpression,
    Block,
    CallExpression,
    CaseClause,
    Expression,
    ForOfStatement,
    ForStatement,
    FunctionDeclaration,
    IfStatement,
    Node,
    SourceFile,
    Statement,
    SwitchStatement,
    SyntaxKind,
} from "ts-morph";
import type { BAFAction, BAFBlock, BAFCondition, BAFScript, BAFTopCondition } from "./ir";
import * as utils from "../../common/transpiler-utils";
import type { VarsContext } from "../../common/transpiler-utils";
import type { FuncsContext, TransformerContext } from "./transformer-context";
import { buildSwitchCondition, invertConditions, transformConditionExpr } from "./condition-algebra";
import { unrollFor, unrollForOf, unrollForAsActions, unrollForOfAsActions } from "./loop-unroll";
import { TranspileError } from "../../common/transpile-error";
import { getSharedProject } from "../../common/shared-project";

export class TBAFTransformer implements TransformerContext {
    vars: VarsContext = new Map();
    funcs: FuncsContext = new Map();
    private blocks: BAFBlock[] = [];
    private sourceFile!: SourceFile;

    /**
     * Transform a bundled TypeScript source file to BAF IR.
     */
    transform(sourceFile: SourceFile): BAFScript {
        this.sourceFile = sourceFile;
        this.blocks = [];
        this.vars.clear();
        this.funcs.clear();

        // Pass 1: Collect declarations (read-only)
        this.collectDeclarations();

        // Pass 2: Transform top-level statements to BAF blocks
        for (const stmt of sourceFile.getStatements()) {
            this.transformStatement(stmt, []);
        }

        return {
            sourceFile: sourceFile.getFilePath(),
            blocks: this.blocks,
        };
    }

    /**
     * Collect variable declarations (const/var/let) and function declarations.
     * Note: esbuild converts const to var, so we collect all variable declarations.
     */
    private collectDeclarations() {
        // Collect all variable declarations (esbuild converts const to var)
        for (const varDecl of this.sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
            const name = varDecl.getName();
            const init = varDecl.getInitializer();
            if (init) {
                const value = this.evaluateExpression(init);
                if (value !== undefined) {
                    this.vars.set(name, value);
                }
            }
        }

        // Collect function declarations
        for (const func of this.sourceFile.getFunctions()) {
            const name = func.getName();
            if (name) {
                this.funcs.set(name, func);
            }
        }
    }

    /**
     * Transform a statement, accumulating parent conditions for nested ifs.
     */
    private transformStatement(stmt: Statement, parentConditions: BAFTopCondition[]) {
        // Skip variable and function declarations
        if (stmt.isKind(SyntaxKind.VariableStatement) || stmt.isKind(SyntaxKind.FunctionDeclaration)) {
            return;
        }

        if (stmt.isKind(SyntaxKind.IfStatement)) {
            this.transformIfStatement(stmt as IfStatement, parentConditions);
        } else if (stmt.isKind(SyntaxKind.ForOfStatement)) {
            this.transformForOfStatement(stmt as ForOfStatement, parentConditions);
        } else if (stmt.isKind(SyntaxKind.ForStatement)) {
            this.transformForStatement(stmt as ForStatement, parentConditions);
        } else if (stmt.isKind(SyntaxKind.SwitchStatement)) {
            this.transformSwitchStatement(stmt as SwitchStatement, parentConditions);
        } else if (stmt.isKind(SyntaxKind.Block)) {
            for (const s of (stmt as Block).getStatements()) {
                this.transformStatement(s, parentConditions);
            }
        } else if (stmt.isKind(SyntaxKind.ExpressionStatement)) {
            const expr = stmt.getExpression();
            if (Node.isCallExpression(expr)) {
                const funcName = expr.getExpression().getText();

                // Skip esbuild helper calls
                if (funcName === "__name" || funcName === "__defProp") {
                    return;
                }

                const funcDecl = this.funcs.get(funcName);

                if (funcDecl) {
                    // User-defined function - inline its body
                    this.inlineVoidFunctionCall(expr, funcDecl, parentConditions);
                } else {
                    // Built-in action call
                    const action = this.transformCallToAction(expr);
                    this.blocks.push({
                        conditions: parentConditions.length > 0 ? parentConditions : [this.trueCondition()],
                        actions: [action],
                        response: 100,
                    });
                }
            }
        }
    }

    /**
     * Transform an if statement to BAF blocks.
     */
    private transformIfStatement(ifStmt: IfStatement, parentConditions: BAFTopCondition[]) {
        const condExpr = ifStmt.getExpression();
        const conditions = [...parentConditions, ...transformConditionExpr(this, condExpr)];

        const thenStmt = ifStmt.getThenStatement();
        const elseStmt = ifStmt.getElseStatement();

        // Process then block
        this.processBlock(utils.getBlockStatements(thenStmt), conditions);

        // Handle else block
        if (elseStmt) {
            const invertedConds = invertConditions(this, parentConditions, condExpr);
            if (elseStmt.isKind(SyntaxKind.IfStatement)) {
                // else if - recurse
                this.transformIfStatement(elseStmt as IfStatement, invertedConds);
            } else {
                // else block
                this.processBlock(utils.getBlockStatements(elseStmt), invertedConds);
            }
        }
    }

    /**
     * Process a block of statements - either recurse for nested ifs or emit actions.
     */
    private processBlock(statements: Statement[], conditions: BAFTopCondition[]) {
        const hasNestedIf = statements.some((s) => s.isKind(SyntaxKind.IfStatement));

        if (hasNestedIf) {
            for (const s of statements) {
                this.transformStatement(s, conditions);
            }
        } else {
            const actions = this.transformActionsFromStatements(statements);
            if (actions.length > 0) {
                this.blocks.push({ conditions, actions, response: 100 });
            }
        }
    }

    /**
     * Transform a for-of loop by unrolling.
     */
    private transformForOfStatement(forOf: ForOfStatement, parentConditions: BAFTopCondition[]) {
        const body = forOf.getStatement();
        unrollForOf(this, forOf, () => {
            this.transformStatement(body, parentConditions);
        });
    }

    /**
     * Transform a for loop by unrolling.
     */
    private transformForStatement(forStmt: ForStatement, parentConditions: BAFTopCondition[]) {
        const body = forStmt.getStatement();
        unrollFor(this, forStmt, () => {
            this.transformStatement(body, parentConditions);
        });
    }

    /**
     * Transform a switch statement to multiple IF blocks.
     * Each case becomes a separate IF block testing the switch expression against that case value.
     */
    private transformSwitchStatement(switchStmt: SwitchStatement, parentConditions: BAFTopCondition[]) {
        const switchExpr = switchStmt.getExpression();
        const caseBlock = switchStmt.getCaseBlock();

        for (const clause of caseBlock.getClauses()) {
            if (!clause.isKind(SyntaxKind.CaseClause)) {
                // Default clauses are not supported in BAF
                // BAF doesn't have a way to express "none of the above" conditions cleanly
                throw new TranspileError(
                    `Default case in switch statement is not supported. ` +
                        `BAF cannot represent "none of the above" logic. ` +
                        `Remove the default case or refactor to explicit case values.`,
                );
            }

            const caseClause = clause as CaseClause;
            const caseValue = caseClause.getExpression().getText();

            // Build the condition by augmenting the switch expression with the case value
            const condition = buildSwitchCondition(this, switchExpr, caseValue);
            const conditions = [...parentConditions, condition];

            // Extract statements until break
            const statements = this.extractCaseStatements(caseClause);
            const actions = this.transformActionsFromStatements(statements);

            if (actions.length > 0) {
                this.blocks.push({ conditions, actions, response: 100 });
            }
        }
    }

    /**
     * Extract statements from a case clause until break statement.
     * Returns all statements except the break.
     */
    private extractCaseStatements(caseClause: CaseClause): Statement[] {
        const statements = caseClause.getStatements();
        const result: Statement[] = [];

        for (const stmt of statements) {
            if (stmt.isKind(SyntaxKind.BreakStatement)) {
                break;
            }
            result.push(stmt);
        }

        return result;
    }

    /**
     * Transform a call expression to a BAFCondition (for built-in BAF conditions only).
     * For user functions, use inlineFunctionConditions instead.
     */
    transformCallToCondition(call: CallExpression): BAFCondition {
        const funcName = call.getExpression().getText();
        const args = call.getArguments().map((a) => utils.substituteVars(a.getText(), this.vars));
        return { negated: false, name: funcName, args };
    }

    /**
     * Transform a call expression to a BAFAction.
     */
    private transformCallToAction(call: CallExpression): BAFAction {
        const funcName = call.getExpression().getText();
        const args = call.getArguments().map((a) => utils.substituteVars(a.getText(), this.vars));
        return { name: funcName, args };
    }

    /**
     * Transform statements to BAFActions.
     */
    transformActionsFromStatements(statements: Statement[]): BAFAction[] {
        const actions: BAFAction[] = [];

        for (const stmt of statements) {
            if (stmt.isKind(SyntaxKind.ExpressionStatement)) {
                const expr = stmt.getExpression();
                if (Node.isCallExpression(expr)) {
                    const funcName = expr.getExpression().getText();
                    const funcDecl = this.funcs.get(funcName);

                    if (funcDecl) {
                        // Inline void function: get its body statements as actions
                        const inlinedActions = this.inlineVoidFunction(expr, funcDecl);
                        actions.push(...inlinedActions);
                    } else {
                        actions.push(this.transformCallToAction(expr));
                    }
                }
            } else if (stmt.isKind(SyntaxKind.ForOfStatement)) {
                // Unroll for-of loop into actions
                const unrolledActions = unrollForOfAsActions(this, stmt as ForOfStatement);
                actions.push(...unrolledActions);
            } else if (stmt.isKind(SyntaxKind.ForStatement)) {
                // Unroll for loop into actions
                const unrolledActions = unrollForAsActions(this, stmt as ForStatement);
                actions.push(...unrolledActions);
            }
        }

        return actions;
    }

    /**
     * Inline a void function call at top level, transforming its body statements.
     * This handles functions containing if statements, loops, etc.
     */
    private inlineVoidFunctionCall(
        call: CallExpression,
        funcDecl: FunctionDeclaration,
        parentConditions: BAFTopCondition[],
    ) {
        const body = funcDecl.getBody()?.asKindOrThrow(SyntaxKind.Block);
        if (!body) return;

        this.withParamContext(call, funcDecl, () => {
            for (const stmt of body.getStatements()) {
                this.transformStatement(stmt, parentConditions);
            }
        });
    }

    /**
     * Inline a void function call, returning its actions.
     * Used when inlining inside an if block's action list.
     */
    private inlineVoidFunction(call: CallExpression, funcDecl: FunctionDeclaration): BAFAction[] {
        const body = funcDecl.getBody()?.asKindOrThrow(SyntaxKind.Block);
        if (!body) return [];

        let actions: BAFAction[] = [];
        this.withParamContext(call, funcDecl, () => {
            actions = this.transformActionsFromStatements(body.getStatements());
        });
        return actions;
    }

    /**
     * Execute a function with parameter substitutions in the vars context.
     * Saves and restores the vars context around the callback.
     */
    private withParamContext(call: CallExpression, funcDecl: FunctionDeclaration, fn: () => void): void {
        const paramMap = utils.buildParamMap(call, funcDecl, this.vars);

        const savedVars = new Map(this.vars);
        paramMap.forEach((value, key) => this.vars.set(key, value));

        fn();

        this.vars = savedVars;
    }

    /**
     * Parse a TypeScript expression from a string of code.
     * Creates a temporary in-memory project to parse the expression.
     *
     * @param text - The expression text to parse (e.g., "Global('foo', 'LOCALS')")
     * @returns The parsed Expression node, or undefined if parsing fails
     */
    parseExpressionFromText(text: string): Expression | undefined {
        const project = getSharedProject();
        const tempFile = project.createSourceFile("tbaf-expr.ts", `const _x_ = ${text};`, {
            overwrite: true,
        });
        const varDecl = tempFile.getVariableDeclarations()[0];
        return varDecl?.getInitializer();
    }

    /**
     * Resolve a variable identifier to its underlying expression.
     * If the expression is a variable name, looks it up in the vars context
     * and parses its value as an expression.
     *
     * @param expr - The expression to resolve (may be an identifier or any other expression)
     * @returns The resolved expression (either the parsed variable value or the original expression)
     */
    resolveVariableToExpression(expr: Expression): Expression {
        if (Node.isIdentifier(expr)) {
            const varValue = this.vars.get(expr.getText());
            if (varValue) {
                const parsed = this.parseExpressionFromText(varValue);
                if (parsed) {
                    return parsed;
                }
            }
        }
        return expr;
    }

    /**
     * Evaluate an expression to a string value if possible.
     */
    evaluateExpression(expr: Expression): string | undefined {
        if (expr.isKind(SyntaxKind.ArrayLiteralExpression)) {
            const arr = expr as ArrayLiteralExpression;
            const elements = utils.flattenArrayElements(arr, this.vars);
            return `[${elements.join(", ")}]`;
        }

        if (expr.isKind(SyntaxKind.StringLiteral) || expr.isKind(SyntaxKind.NumericLiteral)) {
            return expr.getText();
        }

        if (expr.isKind(SyntaxKind.Identifier)) {
            const name = expr.getText();
            if (this.vars.has(name)) {
                return this.vars.get(name);
            }
        }

        return expr.getText();
    }

    /**
     * Resolve array elements from an expression.
     */
    resolveArrayElements(expr: Expression): string[] | null {
        if (expr.isKind(SyntaxKind.ArrayLiteralExpression)) {
            return utils.flattenArrayElements(expr as ArrayLiteralExpression, this.vars);
        }

        if (expr.isKind(SyntaxKind.Identifier)) {
            const name = expr.getText();
            const value = this.vars.get(name);
            if (value && value.startsWith("[") && value.endsWith("]")) {
                // Use robust parseArrayLiteral instead of simple split
                return utils.parseArrayLiteral(value);
            }
        }

        return null;
    }

    /**
     * Create an opaque condition (for expressions we can't parse).
     */
    opaqueCondition(text: string, negated: boolean): BAFCondition {
        // Try to parse as a function call
        const match = text.match(/^(\w+)\((.*)\)$/);
        if (match && match[1]) {
            return {
                negated,
                name: match[1],
                args: match[2] ? match[2].split(",").map((s) => s.trim()) : [],
            };
        }

        // Fallback: use True() or False() wrapper
        return {
            negated,
            name: "True",
            args: [],
        };
    }

    /**
     * Create a True() condition placeholder.
     */
    trueCondition(): BAFCondition {
        return {
            negated: false,
            name: "True",
            args: [],
        };
    }
}
