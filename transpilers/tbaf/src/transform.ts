/**
 * TBAF Transformer
 *
 * Bundled TypeScript to BAF IR. Every value, condition and loop goes through the compile-time evaluator
 * (`common/compile-time-eval.ts`), so a block either says what the source means or the transpile refuses.
 *
 * Block layout: an `if` body whose statements are all actions becomes one block; an `if` body that holds a
 * further `if` or `switch` (directly, in a nested block or loop, or in a helper it calls) gives each of its
 * statements its own blocks, as does the top level.
 */

import {
    type CallExpression,
    type IfStatement,
    type SourceFile,
    type Statement,
    type SwitchStatement,
    Node,
    SyntaxKind,
} from "ts-morph";
import type { BAFAction, BAFBlock, BAFCondition, BAFScript, BAFTopCondition } from "./ir";
import { dnfToCnf } from "./cnf";
import {
    Scope,
    bindArguments,
    conjunction,
    declareStatements,
    disjunction,
    evaluate,
    evaluateCondition,
    negate,
    unrollFor,
    unrollForOf,
    type Condition,
} from "../../common/compile-time-eval";
import { formatArgument, type ArgumentStyle, type FunctionValue, type Value } from "../../common/compile-time-value";
import { TranspileError } from "../../common/transpile-error";
import { lineNumberOfNode } from "../../common/line-index";

const BAF_ARGUMENTS: ArgumentStyle = { separator: ", " };

const ALWAYS: Condition = { kind: "constant", value: true };

/** Calls esbuild inserts into a bundle for its own bookkeeping; none of them is an action. */
const BUNDLER_HELPERS: ReadonlySet<string> = new Set(["__name", "__defProp"]);

export class TBAFTransformer {
    private blocks: BAFBlock[] = [];

    /** Transform a bundled TypeScript source file to BAF IR. */
    transform(sourceFile: SourceFile): BAFScript {
        this.blocks = [];
        const scope = new Scope();
        const statements = sourceFile.getStatements();
        declareStatements(scope, statements);
        for (const statement of statements) this.transformStatement(statement, scope, ALWAYS);
        return { sourceFile: sourceFile.getFilePath(), blocks: this.blocks };
    }

    /** One statement at a level that gives each statement its own blocks, all under `condition`. */
    private transformStatement(statement: Statement, scope: Scope, condition: Condition): void {
        if (isDeclarationOnly(statement)) return;
        if (Node.isIfStatement(statement)) {
            this.transformIf(statement, scope, condition);
        } else if (Node.isSwitchStatement(statement)) {
            this.transformSwitch(statement, scope, condition);
        } else if (Node.isBlock(statement)) {
            const inner = blockScope(scope, statement.getStatements());
            for (const s of statement.getStatements()) this.transformStatement(s, inner, condition);
        } else if (Node.isForStatement(statement)) {
            unrollFor(statement, scope, (iteration) =>
                this.transformStatement(statement.getStatement(), iteration, condition),
            );
        } else if (Node.isForOfStatement(statement)) {
            unrollForOf(statement, scope, (iteration) =>
                this.transformStatement(statement.getStatement(), iteration, condition),
            );
        } else {
            const call = statementCall(statement);
            if (call === undefined) return;
            const helper = calledHelper(call, scope);
            if (helper !== undefined) {
                const body = helperBody(helper, call, scope);
                for (const s of body.statements) this.transformStatement(s, body.scope, condition);
                return;
            }
            this.blocks.push({
                conditions: toBlockConditions(condition),
                actions: [toAction(call, scope)],
                response: 100,
            });
        }
    }

    private transformIf(statement: IfStatement, scope: Scope, parent: Condition): void {
        const own = evaluateCondition(statement.getExpression(), scope);
        this.transformBranch(statement.getThenStatement(), scope, conjunction([parent, own]));
        const otherwise = statement.getElseStatement();
        if (otherwise === undefined) return;
        const inverted = conjunction([parent, negate(own)]);
        if (Node.isIfStatement(otherwise)) this.transformIf(otherwise, scope, inverted);
        else this.transformBranch(otherwise, scope, inverted);
    }

    /** An `if` or `case` body under `condition`, skipped whole when the condition is false at compile time. */
    private transformBranch(body: Statement, scope: Scope, condition: Condition): void {
        const statements = Node.isBlock(body) ? body.getStatements() : [body];
        this.transformStatements(statements, Node.isBlock(body) ? blockScope(scope, statements) : scope, condition);
    }

    private transformStatements(statements: readonly Statement[], scope: Scope, condition: Condition): void {
        if (condition.kind === "constant" && !condition.value) return;
        if (statements.some((s) => needsBlocks(s, scope, new Set()))) {
            for (const s of statements) this.transformStatement(s, scope, condition);
            return;
        }
        const actions = statements.flatMap((s) => collectActions(s, scope));
        if (actions.length > 0) this.blocks.push({ conditions: toBlockConditions(condition), actions, response: 100 });
    }

    /**
     * One block per case, its condition the switch call with the case value appended - how BAF's comparison
     * triggers take the value they test. Empty cases stacked above one with statements share its block.
     */
    private transformSwitch(statement: SwitchStatement, scope: Scope, parent: Condition): void {
        const subjectExpr = statement.getExpression();
        const subject = evaluate(subjectExpr, scope);
        if (subject.kind !== "call") {
            throw TranspileError.fromNode(
                subjectExpr,
                `Switch expression "${subjectExpr.getText()}" is not supported. ` +
                    "Only function call expressions (like Global()) are supported in switch statements.",
            );
        }
        const clauses = statement.getCaseBlock().getClauses();
        let pending: Value[] = [];
        clauses.forEach((clause, index) => {
            if (!Node.isCaseClause(clause)) {
                throw TranspileError.fromNode(
                    clause,
                    "Default case in switch statement is not supported. " +
                        'BAF cannot represent "none of the above" logic. ' +
                        "Remove the default case or refactor to explicit case values.",
                );
            }
            pending.push(evaluate(clause.getExpression(), scope));
            const statements = clause.getStatements();
            if (statements.length === 0) return;
            const breakAt = statements.findIndex((s) => Node.isBreakStatement(s));
            if (breakAt === -1 && index < clauses.length - 1) {
                throw TranspileError.fromNode(
                    clause,
                    "a case that falls through into the next is not supported; end it with break",
                );
            }
            const body = breakAt === -1 ? statements : statements.slice(0, breakAt);
            const values = pending;
            pending = [];
            const atoms: Condition[] = values.map((value) => ({
                kind: "atom",
                negated: false,
                name: subject.name,
                args: [...subject.args, value],
                node: subjectExpr,
            }));
            this.transformStatements(body, blockScope(scope, body), conjunction([parent, disjunction(atoms)]));
        });
    }
}

/** A statement that only declares: its names are bound by `declareStatements`, and it emits nothing itself. */
function isDeclarationOnly(statement: Statement): boolean {
    return (
        Node.isVariableStatement(statement) ||
        Node.isFunctionDeclaration(statement) ||
        Node.isEmptyStatement(statement) ||
        Node.isInterfaceDeclaration(statement) ||
        Node.isTypeAliasDeclaration(statement) ||
        (Node.isModuleDeclaration(statement) && statement.hasDeclareKeyword()) ||
        (Node.isEnumDeclaration(statement) && statement.hasDeclareKeyword())
    );
}

/** A child scope holding the block's own constants and functions. */
function blockScope(scope: Scope, statements: readonly Statement[]): Scope {
    const inner = scope.child();
    declareStatements(inner, statements);
    return inner;
}

/** The call an expression statement makes, undefined for a bundler helper; any other statement is refused. */
function statementCall(statement: Statement): CallExpression | undefined {
    if (Node.isExpressionStatement(statement)) {
        const expr = statement.getExpression();
        if (Node.isCallExpression(expr)) {
            return BUNDLER_HELPERS.has(expr.getExpression().getText()) ? undefined : expr;
        }
        const assignment =
            (Node.isBinaryExpression(expr) &&
                expr.getOperatorToken().getKind() >= SyntaxKind.FirstAssignment &&
                expr.getOperatorToken().getKind() <= SyntaxKind.LastAssignment) ||
            Node.isPostfixUnaryExpression(expr) ||
            (Node.isPrefixUnaryExpression(expr) &&
                (expr.getOperatorToken() === SyntaxKind.PlusPlusToken ||
                    expr.getOperatorToken() === SyntaxKind.MinusMinusToken));
        throw TranspileError.fromNode(
            statement,
            assignment
                ? "an assignment is not supported; a compile-time value cannot change"
                : `${expr.getKindName()} is not supported as a statement; a statement is an action call`,
        );
    }
    throw TranspileError.fromNode(statement, `${statement.getKindName()} is not supported`);
}

/** The function the source declares that `call` calls, inlined in place of the call; undefined for an action. */
function calledHelper(call: CallExpression, scope: Scope): FunctionValue | undefined {
    const callee = call.getExpression();
    if (!Node.isIdentifier(callee)) return undefined;
    const bound = scope.lookup(callee.getText(), callee);
    return bound?.kind === "function" ? bound : undefined;
}

function helperBody(
    helper: FunctionValue,
    call: CallExpression,
    scope: Scope,
): { scope: Scope; statements: Statement[] } {
    const statements = helper.declaration.getBody()?.asKind(SyntaxKind.Block)?.getStatements() ?? [];
    const body = bindArguments(helper, call, scope);
    declareStatements(body, statements);
    return { scope: body, statements };
}

/**
 * Whether `statement` holds an `if` or `switch`, which needs blocks of its own. `visiting` stops a helper that
 * calls itself, which inlining could never finish anyway.
 */
function needsBlocks(statement: Statement, scope: Scope, visiting: Set<FunctionValue>): boolean {
    if (Node.isIfStatement(statement) || Node.isSwitchStatement(statement)) return true;
    if (Node.isBlock(statement)) return statement.getStatements().some((s) => needsBlocks(s, scope, visiting));
    if (Node.isForStatement(statement) || Node.isForOfStatement(statement)) {
        return needsBlocks(statement.getStatement(), scope, visiting);
    }
    if (Node.isExpressionStatement(statement)) {
        const expr = statement.getExpression();
        if (!Node.isCallExpression(expr)) return false;
        const helper = calledHelper(expr, scope);
        if (helper === undefined || visiting.has(helper)) return false;
        visiting.add(helper);
        const statements = helper.declaration.getBody()?.asKind(SyntaxKind.Block)?.getStatements() ?? [];
        return statements.some((s) => needsBlocks(s, helper.closure, visiting));
    }
    return false;
}

/** The actions `statement` performs, loops unrolled and helpers inlined; it holds no `if` or `switch`. */
function collectActions(statement: Statement, scope: Scope): BAFAction[] {
    if (isDeclarationOnly(statement)) return [];
    if (Node.isBlock(statement)) {
        const inner = blockScope(scope, statement.getStatements());
        return statement.getStatements().flatMap((s) => collectActions(s, inner));
    }
    if (Node.isForStatement(statement) || Node.isForOfStatement(statement)) {
        const actions: BAFAction[] = [];
        const body = statement.getStatement();
        const onIteration = (iteration: Scope) => actions.push(...collectActions(body, iteration));
        if (Node.isForStatement(statement)) unrollFor(statement, scope, onIteration);
        else unrollForOf(statement, scope, onIteration);
        return actions;
    }
    const call = statementCall(statement);
    if (call === undefined) return [];
    const helper = calledHelper(call, scope);
    if (helper !== undefined) {
        const body = helperBody(helper, call, scope);
        return body.statements.flatMap((s) => collectActions(s, body.scope));
    }
    return [toAction(call, scope)];
}

function toAction(call: CallExpression, scope: Scope): BAFAction {
    const value = evaluate(call, scope);
    if (value.kind !== "call") {
        throw TranspileError.fromNode(call, `'${call.getText()}' is a value, not an action`);
    }
    return {
        name: value.name,
        args: value.args.map((arg) => formatArgument(arg, BAF_ARGUMENTS, call)),
        // Counted from 1, as ts-morph does; everything downstream of the bundler counts from 0.
        line: lineNumberOfNode(call) - 1,
    };
}

/** A block's conditions: the folded condition in BAF's AND-of-OR-groups form, `True()` when nothing is left. */
function toBlockConditions(condition: Condition): BAFTopCondition[] {
    const cnf = toCnf(condition);
    return cnf.length > 0 ? cnf : [{ negated: false, name: "True", args: [] }];
}

function toCnf(condition: Condition): BAFTopCondition[] {
    switch (condition.kind) {
        case "constant":
            // A false condition never reaches here: transformStatements skips its body.
            return [];
        case "atom":
            return [toBafCondition(condition)];
        case "and":
            return condition.items.flatMap(toCnf);
        case "or":
            return dnfToCnf(condition.items.map(toCnf));
    }
}

function toBafCondition(atom: Extract<Condition, { kind: "atom" }>): BAFCondition {
    return {
        negated: atom.negated,
        name: atom.name,
        args: atom.args.map((arg) => formatArgument(arg, BAF_ARGUMENTS, atom.node)),
        line: lineNumberOfNode(atom.node) - 1,
    };
}
