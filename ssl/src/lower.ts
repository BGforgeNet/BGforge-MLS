/**
 * Lowers a parsed SSL syntax tree to the INT emitter's IR.
 *
 * Two passes. The first walks the top level in source order and collects every declaration, because the
 * name table is built in that order and its offsets are baked into the output. The second lowers each
 * procedure body against a scope built from that collection.
 *
 * Anything the lowering does not yet handle throws `LowerError` rather than emitting something
 * approximate: a wrong instruction produces a script that misbehaves in-game, where a thrown error is a
 * gap someone can close.
 */

import type { Node as SyntaxNode, Tree } from "web-tree-sitter";
import { engineFunction } from "./int/engine-functions";
import type { AssignOp, BinaryOp, Declaration, Expr, ProcedureDecl, Program, Stmt, VariableDecl } from "./int/ir";

export class LowerError extends Error {
    readonly line: number;
    constructor(message: string, node: SyntaxNode) {
        super(`${node.startPosition.row + 1}:${node.startPosition.column + 1}: ${message}`);
        this.name = "LowerError";
        this.line = node.startPosition.row + 1;
    }
}

/** Which game's engine vocabulary to resolve function names against. */
export interface LowerOptions {
    game?: 1 | 2;
}

const BINARY_OPS = new Set<string>([
    "+",
    "-",
    "*",
    "/",
    "%",
    "^",
    "div",
    "==",
    "!=",
    "<=",
    ">=",
    "<",
    ">",
    "and",
    "or",
    "bwand",
    "bwor",
    "bwxor",
]);

const ASSIGN_OPS = new Set<string>(["=", ":=", "+=", "-=", "*=", "/="]);

/** A procedure's locals, arguments first - the slot order the emitter and the engine both assume. */
interface Scope {
    slots: Map<string, number>;
}

class Lowering {
    private readonly game: 1 | 2;
    /** Procedure name to its index among real procedures, lowercased since names are case-insensitive. */
    private readonly procedures = new Map<string, number>();
    private readonly globals = new Map<string, number>();
    private readonly externals = new Map<string, string>();
    private readonly declarations: Declaration[] = [];

    constructor(options: LowerOptions) {
        this.game = options.game ?? 2;
    }

    lower(root: SyntaxNode): Program {
        this.collect(root);
        this.lowerBodies(root);
        return { declarations: this.declarations };
    }

    /**
     * First pass: every declared name, in source order. A procedure may be forward-declared and then
     * defined; both mention the name, and only the first occurrence allocates its table slot.
     */
    private collect(root: SyntaxNode): void {
        for (const child of root.namedChildren) {
            if (!child) continue;
            switch (child.type) {
                case "procedure_forward":
                case "procedure": {
                    const name = this.nameOf(child);
                    if (this.procedures.has(name.toLowerCase())) break;
                    this.procedures.set(name.toLowerCase(), this.procedures.size);
                    this.declarations.push({
                        kind: "procedure",
                        procedure: { name, args: [], locals: [], body: [] },
                    });
                    break;
                }
                case "variable_decl":
                    this.collectVariables(child, child.text.trimStart().toLowerCase().startsWith("import"));
                    break;
                case "export_decl":
                    this.collectExport(child);
                    break;
            }
        }
    }

    private collectVariables(node: SyntaxNode, imported: boolean): void {
        for (const init of node.namedChildren) {
            if (!init || init.type !== "var_init") continue;
            const name = this.nameOf(init);
            if (imported) {
                this.externals.set(name.toLowerCase(), name);
                this.declarations.push({ kind: "external", variable: this.variableOf(init) });
            } else {
                if (this.globals.has(name.toLowerCase())) continue;
                this.globals.set(name.toLowerCase(), this.globals.size);
                this.declarations.push({ kind: "global", variable: this.variableOf(init) });
            }
        }
    }

    /**
     * `export variable g := 1;`. The node carries its name and value directly rather than wrapping a
     * `var_init`, so this cannot share `collectVariables`.
     *
     * Exporting a PROCEDURE is not handled: the grammar has no such form, and no script in the corpus
     * uses one. It is a grammar gap rather than a lowering gap, so closing it starts there.
     */
    private collectExport(node: SyntaxNode): void {
        const name = this.nameOf(node);
        const value = node.childForFieldName("value");
        this.externals.set(name.toLowerCase(), name);
        this.declarations.push({
            kind: "external",
            variable: {
                name,
                initial: value ? this.constantOf(value) : { kind: "int", value: 0 },
                exported: true,
            },
        });
    }

    private variableOf(init: SyntaxNode): VariableDecl {
        const name = this.nameOf(init);
        const value = init.childForFieldName("value");
        return { name, initial: value ? this.constantOf(value) : { kind: "int", value: 0 } };
    }

    /**
     * A declared initial value is written into the program image rather than computed, so it must be a
     * literal. Anything else is a gap in the lowering, not something to approximate with zero.
     */
    private constantOf(node: SyntaxNode): VariableDecl["initial"] {
        switch (node.type) {
            case "number": {
                const text = node.text;
                if (text.includes(".")) return { kind: "float", value: Number.parseFloat(text) };
                const radix = text.startsWith("0x") || text.startsWith("0X") ? 16 : 10;
                return { kind: "int", value: Number.parseInt(text, radix) };
            }
            case "string":
                return { kind: "string", value: unquote(node.text) };
            case "boolean":
                return { kind: "int", value: node.text.toLowerCase() === "true" ? 1 : 0 };
            case "unary_expr": {
                const operand = node.childForFieldName("expr");
                const op = node.childForFieldName("op")?.text;
                if (op === "-" && operand) {
                    const inner = this.constantOf(operand);
                    if (inner.kind === "int") return { kind: "int", value: -inner.value };
                    if (inner.kind === "float") return { kind: "float", value: -inner.value };
                }
                break;
            }
        }
        throw new LowerError(`initial value must be a literal, got ${node.type}`, node);
    }

    private nameOf(node: SyntaxNode): string {
        const name = node.childForFieldName("name");
        if (!name) throw new LowerError(`${node.type} has no name`, node);
        return name.text;
    }

    /** Second pass: fill in each procedure's arguments, locals and body. */
    private lowerBodies(root: SyntaxNode): void {
        const byIndex = this.declarations.filter((d) => d.kind === "procedure");
        for (const child of root.namedChildren) {
            if (!child || child.type !== "procedure") continue;
            const index = this.procedures.get(this.nameOf(child).toLowerCase());
            const entry = index === undefined ? undefined : byIndex[index];
            if (entry?.kind !== "procedure") continue;
            this.lowerProcedure(child, entry.procedure);
        }
    }

    private lowerProcedure(node: SyntaxNode, target: ProcedureDecl): void {
        const scope: Scope = { slots: new Map() };
        const params = node.childForFieldName("params");
        if (params) {
            for (const param of params.namedChildren) {
                if (!param || param.type !== "param") continue;
                const name = this.nameOf(param);
                scope.slots.set(name.toLowerCase(), scope.slots.size);
                target.args.push(name);
            }
        }

        // A procedure holds its statements as REPEATED `body` fields rather than one block child, so
        // `childForFieldName` would silently return only the first statement.
        const body = node.childrenForFieldName("body").filter((c): c is SyntaxNode => c !== null);

        // Local declarations are hoisted: their initial values are pushed once at procedure entry, so
        // the declaration statement itself emits nothing wherever it appears in the body.
        for (const statement of body) this.hoistLocals(statement, scope, target);
        target.body = this.lowerEach(body, scope);

        if (node.children.some((c) => c?.type === "critical")) target.critical = true;
    }

    private hoistLocals(node: SyntaxNode, scope: Scope, target: ProcedureDecl): void {
        if (node.type === "variable_decl") {
            for (const init of node.namedChildren) {
                if (!init || init.type !== "var_init") continue;
                const name = this.nameOf(init);
                if (scope.slots.has(name.toLowerCase())) continue;
                scope.slots.set(name.toLowerCase(), scope.slots.size);
                target.locals.push(this.variableOf(init));
            }
            return;
        }
        for (const child of node.namedChildren) {
            if (child) this.hoistLocals(child, scope, target);
        }
    }

    /** Lowers an explicit statement list, dropping the ones that emit nothing. */
    private lowerEach(nodes: SyntaxNode[], scope: Scope): Stmt[] {
        const out: Stmt[] = [];
        for (const node of nodes) {
            const statement = this.lowerStatement(node, scope);
            if (statement) out.push(statement);
        }
        return out;
    }

    private lowerStatements(node: SyntaxNode, scope: Scope): Stmt[] {
        return this.lowerEach(
            node.namedChildren.filter((c): c is SyntaxNode => c !== null),
            scope,
        );
    }

    private lowerStatement(node: SyntaxNode, scope: Scope): Stmt | null {
        switch (node.type) {
            // Comments emit nothing, and a local declaration is hoisted to procedure entry, so the
            // declaration statement itself contributes no code wherever it appears.
            case "comment":
            case "line_comment":
            case "empty_statement":
            case "variable_decl":
                return null;

            case "block":
                return { kind: "block", body: this.lowerStatements(node, scope) };

            case "if_stmt": {
                const cond = this.required(node, "cond", scope);
                const thenBranch = this.branch(node, "then", scope);
                const otherwise = node.childForFieldName("else");
                const result: Stmt = { kind: "if", cond, thenBranch };
                if (otherwise) return { ...result, elseBranch: this.lowerBranchNode(otherwise, scope) };
                return result;
            }

            case "while_stmt":
                return {
                    kind: "while",
                    cond: this.required(node, "cond", scope),
                    body: this.branch(node, "body", scope),
                };

            case "return_stmt": {
                const value = node.namedChildren.find((c) => c && c.type !== "comment" && c.type !== "line_comment");
                return { kind: "return", value: value ? this.lowerExpression(value, scope) : undefined };
            }

            case "break_stmt":
                return { kind: "break" };

            case "continue_stmt":
                return { kind: "continue" };

            case "assignment":
                return this.lowerAssignment(node, scope);

            case "call_stmt":
                return this.lowerCallStatement(node, scope);

            case "expression_stmt": {
                const inner = node.namedChildren.find((c) => c && c.type !== "comment" && c.type !== "line_comment");
                if (!inner) return null;
                return this.lowerExpressionStatement(inner, scope);
            }
        }
        throw new LowerError(`unsupported statement '${node.type}'`, node);
    }

    private branch(node: SyntaxNode, field: string, scope: Scope): Stmt {
        const child = node.childForFieldName(field);
        if (!child) throw new LowerError(`${node.type} has no '${field}'`, node);
        return this.lowerBranchNode(child, scope);
    }

    private lowerBranchNode(node: SyntaxNode, scope: Scope): Stmt {
        return this.lowerStatement(node, scope) ?? { kind: "block", body: [] };
    }

    private required(node: SyntaxNode, field: string, scope: Scope): Expr {
        const child = node.childForFieldName(field);
        if (!child) throw new LowerError(`${node.type} has no '${field}'`, node);
        return this.lowerExpression(child, scope);
    }

    private lowerAssignment(node: SyntaxNode, scope: Scope): Stmt {
        const left = node.childForFieldName("left");
        const right = node.childForFieldName("right");
        if (!left || !right) throw new LowerError("malformed assignment", node);
        const target = this.lowerExpression(left, scope);
        if (target.kind !== "var") throw new LowerError("assignment target must be a variable", left);
        const operator = node.children.find((c) => c && ASSIGN_OPS.has(c.text))?.text ?? "=";
        const op = (operator === ":=" ? "=" : operator) as AssignOp;
        return { kind: "assign", target, op, value: this.lowerExpression(right, scope) };
    }

    /** `call foo(...)` invokes a procedure and discards its result. */
    private lowerCallStatement(node: SyntaxNode, scope: Scope): Stmt {
        const target = node.childForFieldName("target");
        if (!target) throw new LowerError("call has no target", node);
        if (node.childForFieldName("delay")) {
            throw new LowerError("timed calls are not lowered yet", node);
        }
        if (target.type === "call_expr") {
            const { callee, args } = this.callParts(target, scope);
            return { kind: "callStmt", target: callee, args };
        }
        return { kind: "callStmt", target: this.procedureRef(target), args: [] };
    }

    /**
     * A bare expression statement is either an engine function used for its effect or a procedure call
     * whose result is discarded; the two compile differently, so the callee decides.
     */
    private lowerExpressionStatement(node: SyntaxNode, scope: Scope): Stmt {
        if (node.type === "call_expr") {
            const callee = node.childForFieldName("func");
            if (callee?.type === "identifier") {
                const engine = engineFunction(callee.text.toLowerCase(), this.game);
                if (engine) {
                    const args = this.argumentsOf(node, scope);
                    const statement: Stmt = { kind: "libStmt", opcode: engine.opcode, args };
                    return engine.popsResult ? { ...statement, popsResult: true } : statement;
                }
            }
            const { callee: target, args } = this.callParts(node, scope);
            return { kind: "callStmt", target, args };
        }
        return { kind: "expr", expr: this.lowerExpression(node, scope) };
    }

    private callParts(node: SyntaxNode, scope: Scope): { callee: Expr; args: Expr[] } {
        const func = node.childForFieldName("func");
        if (!func) throw new LowerError("call has no callee", node);
        return { callee: this.procedureRef(func), args: this.argumentsOf(node, scope) };
    }

    private argumentsOf(node: SyntaxNode, scope: Scope): Expr[] {
        // namedChildren[0] is the callee; comments can appear between arguments.
        return node.namedChildren
            .slice(1)
            .filter((c): c is SyntaxNode => Boolean(c) && c.type !== "comment" && c.type !== "line_comment")
            .map((c) => this.lowerExpression(c, scope));
    }

    private procedureRef(node: SyntaxNode): Expr {
        if (node.type !== "identifier") throw new LowerError(`cannot call a '${node.type}'`, node);
        const index = this.procedures.get(node.text.toLowerCase());
        if (index === undefined) throw new LowerError(`unknown procedure '${node.text}'`, node);
        return { kind: "procRef", index };
    }

    private lowerExpression(node: SyntaxNode, scope: Scope): Expr {
        switch (node.type) {
            case "number":
            case "string":
            case "boolean":
                return this.constantOf(node);

            case "paren_expr": {
                const inner = node.namedChildren.find((c) => c && c.type !== "comment");
                if (!inner) throw new LowerError("empty parentheses", node);
                return this.lowerExpression(inner, scope);
            }

            case "identifier":
                return this.reference(node, scope);

            case "proc_ref": {
                const name = node.namedChildren[0];
                if (!name) throw new LowerError("malformed procedure reference", node);
                const index = this.procedures.get(name.text.toLowerCase());
                if (index === undefined) throw new LowerError(`unknown procedure '${name.text}'`, name);
                return { kind: "procRef", index };
            }

            case "unary_expr": {
                const operand = node.childForFieldName("expr");
                const op = node.childForFieldName("op")?.text?.toLowerCase();
                if (!operand || !op) throw new LowerError("malformed unary expression", node);
                if (op === "-") return { kind: "unary", op: "negate", operand: this.lowerExpression(operand, scope) };
                if (op === "not" || op === "bwnot" || op === "floor") {
                    return { kind: "unary", op, operand: this.lowerExpression(operand, scope) };
                }
                throw new LowerError(`unsupported unary operator '${op}'`, node);
            }

            case "binary_expr": {
                const left = node.childForFieldName("left");
                const right = node.childForFieldName("right");
                const op = node.childForFieldName("op")?.text?.toLowerCase();
                if (!left || !right || !op) throw new LowerError("malformed binary expression", node);
                if (!BINARY_OPS.has(op)) throw new LowerError(`unsupported operator '${op}'`, node);
                return {
                    kind: "binary",
                    op: op as BinaryOp,
                    left: this.lowerExpression(left, scope),
                    right: this.lowerExpression(right, scope),
                };
            }

            case "ternary_expr": {
                const whenTrue = node.childForFieldName("true_value");
                const cond = node.childForFieldName("cond");
                const whenFalse = node.childForFieldName("false_value");
                if (!whenTrue || !cond || !whenFalse) throw new LowerError("malformed conditional", node);
                return {
                    kind: "ternary",
                    cond: this.lowerExpression(cond, scope),
                    whenTrue: this.lowerExpression(whenTrue, scope),
                    whenFalse: this.lowerExpression(whenFalse, scope),
                };
            }

            case "call_expr": {
                const func = node.childForFieldName("func");
                if (func?.type === "identifier") {
                    const engine = engineFunction(func.text.toLowerCase(), this.game);
                    if (engine) {
                        return { kind: "libCall", opcode: engine.opcode, args: this.argumentsOf(node, scope) };
                    }
                }
                const { callee, args } = this.callParts(node, scope);
                return { kind: "call", target: callee, args };
            }
        }
        throw new LowerError(`unsupported expression '${node.type}'`, node);
    }

    /** Resolves a bare identifier: locals shadow globals, which shadow shared variables. */
    private reference(node: SyntaxNode, scope: Scope): Expr {
        const key = node.text.toLowerCase();
        const slot = scope.slots.get(key);
        if (slot !== undefined) return { kind: "var", scope: "local", index: slot, name: node.text };
        const global = this.globals.get(key);
        if (global !== undefined) return { kind: "var", scope: "global", index: global, name: node.text };
        const external = this.externals.get(key);
        if (external !== undefined) return { kind: "var", scope: "external", index: 0, name: external };
        // An engine function with no arguments is written without parentheses.
        const engine = engineFunction(key, this.game);
        if (engine) return { kind: "libCall", opcode: engine.opcode, args: [] };
        throw new LowerError(`unknown identifier '${node.text}'`, node);
    }
}

function unquote(text: string): string {
    return text
        .slice(1, -1)
        .replaceAll(/\\(.)/g, (_, char: string) =>
            char === "n" ? "\n" : char === "t" ? "\t" : char === "r" ? "\r" : char,
        );
}

/** Lowers a parsed SSL tree to the emitter's IR. */
export function lowerProgram(tree: Tree, options: LowerOptions = {}): Program {
    return new Lowering(options).lower(tree.rootNode);
}
