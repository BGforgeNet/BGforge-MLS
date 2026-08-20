/**
 * TSSL straight to the compiler's IR, with no SSL text in between.
 *
 * The back end was built to take a tree from more than one front end - `compilers/ssl/src/int/ir.ts`
 * says so and names this one. What is left for a front end is resolving names to slots and walking its
 * own AST; the constructs whose expansion carries byte-exact invariants are not reimplemented here but
 * taken from `compilers/ssl/src/desugar.ts`, which nothing below reaches yet only because `for`,
 * `foreach`, `switch` and array literals are still refused.
 *
 * **Incomplete by construction, and refusing is how it stays honest.** Every construct it does not yet
 * lower is refused with the line it sits on rather than approximated, so the coverage figure
 * `pnpm tssl-int-diff` reports is the real one. Grow it against that differential while the text route
 * still exists to be compared with: once a mod stops committing its generated `.ssl`, the only remaining
 * check on this file is a digest that says a byte moved without saying which construct moved it.
 *
 * Order is the constraint to respect when extending. The name table is built in declaration order and
 * its offsets are baked into the procedure table, so declarations must be produced in exactly the order
 * the text route's emitter renders them: forward declarations for every kept procedure, bundled modules
 * before the entry, then variables, then bodies.
 */

import { Project, SyntaxKind, type FunctionDeclaration, type Node } from "ts-morph";
import type {
    BinaryOp,
    Declaration,
    Expr,
    ProcedureDecl,
    Program,
    Stmt,
    VariableDecl,
} from "../../../../compilers/ssl/src/int/ir";
import { engineFunction } from "../../../../compilers/ssl/src/int/engine-functions";
import {
    buildProgramModel,
    refuseAt,
    shadowEntryPath,
    TSSL_COMPILER_OPTIONS,
    type TsslProgram,
} from "../program-model";
import { extractInlineFunctions } from "../inline-functions";
// Generated from server/data/fallout-ssl-base.yml by generate-data.sh.
import engineProcedureNames from "../../../../server/out/fallout-ssl-engine-procedures.json";

/** Builds the IR for one `.tssl` compilation unit. Throws a positioned refusal on anything unhandled. */
export function lowerTsslProgram(filePath: string, text: string): Program {
    const project = new Project({ compilerOptions: TSSL_COMPILER_OPTIONS });
    const entry = project.createSourceFile(shadowEntryPath(filePath), text, { overwrite: true });
    project.resolveSourceFileDependencies();
    const model = buildProgramModel(project, entry, filePath, engineProcedureNames, (source) =>
        extractInlineFunctions(source),
    );
    return new TsslLowering(model).lower();
}

/** A procedure's locals, arguments first - the slot order the emitter and the engine both assume. */
interface Scope {
    slots: Map<string, number>;
}

/** TypeScript spellings that mean an SSL binary operator. Anything absent is refused, not guessed. */
const BINARY_OPS = new Map<string, BinaryOp>([
    ["+", "+"],
    ["-", "-"],
    ["*", "*"],
    ["/", "/"],
    ["%", "%"],
    ["==", "=="],
    ["===", "=="],
    ["!=", "!="],
    ["!==", "!="],
    ["<", "<"],
    ["<=", "<="],
    [">", ">"],
    [">=", ">="],
    ["&", "bwand"],
    ["|", "bwor"],
    ["^", "bwxor"],
]);

const ASSIGN_OPS = new Map<string, "=" | "+=" | "-=" | "*=" | "/=">([
    ["=", "="],
    ["+=", "+="],
    ["-=", "-="],
    ["*=", "*="],
    ["/=", "/="],
]);

class TsslLowering {
    private readonly declarations: Declaration[] = [];
    /** Procedure slot per name, allocated by the forward-declaration pass. */
    private readonly procedures = new Map<string, number>();
    private readonly strings: string[] = [];
    /** The procedure a local declaration appends its slot to. */
    private currentProcedure: ProcedureDecl | null = null;
    private readonly model: TsslProgram;

    constructor(model: TsslProgram) {
        this.model = model;
    }

    lower(): Program {
        const kept = this.keptFunctions();
        // Forward declarations first: they allocate every procedure slot, and their order is the name
        // table's order.
        for (const func of kept) {
            const name = func.getName();
            if (name === undefined) continue;
            this.procedures.set(name, this.declarations.length);
            this.declarations.push({
                kind: "procedure",
                procedure: { name, args: [], locals: [], body: [] },
            });
        }
        for (const func of kept) this.lowerBody(func);
        return {
            declarations: this.declarations,
            ...(this.strings.length > 0 ? { stringLiterals: this.strings } : {}),
        };
    }

    /**
     * Kept procedures in emission order: bundled modules in dependency order, the entry last. Inline
     * functions and the `list`/`map` helpers expand at their call sites and never become procedures.
     */
    private keptFunctions(): FunctionDeclaration[] {
        const out: FunctionDeclaration[] = [];
        for (const module of this.model.modules) {
            for (const func of module.functions) {
                const name = func.getName();
                if (name === undefined || !this.model.kept.has(func)) continue;
                if (this.model.inlineFunctions.has(name) || name === "list" || name === "map") continue;
                out.push(func);
            }
        }
        return out;
    }

    private lowerBody(func: FunctionDeclaration): void {
        const name = func.getName();
        if (name === undefined) return;
        const index = this.procedures.get(name);
        if (index === undefined) return;
        const entry = this.declarations[index];
        if (entry === undefined || entry.kind !== "procedure") return;

        if (func.getParameters().length > 0) throw refuseAt(func, "procedure parameters are not lowered yet");
        const body = func.getBody();
        if (body === undefined) throw refuseAt(func, "a procedure with no body has nothing to lower");

        const scope: Scope = { slots: new Map() };
        this.currentProcedure = entry.procedure;
        entry.procedure.body = this.lowerStatements(body, scope);
        this.currentProcedure = null;
    }

    private lowerStatements(block: Node, scope: Scope): Stmt[] {
        const out: Stmt[] = [];
        for (const statement of block.getChildrenOfKind(SyntaxKind.SyntaxList).flatMap((list) => list.getChildren())) {
            const lowered = this.lowerStatement(statement, scope);
            if (lowered) out.push(lowered);
        }
        return out;
    }

    private lowerStatement(node: Node, scope: Scope): Stmt | null {
        switch (node.getKind()) {
            case SyntaxKind.VariableStatement:
                return this.lowerLocalDeclaration(node, scope);

            case SyntaxKind.IfStatement: {
                const statement = node.asKindOrThrow(SyntaxKind.IfStatement);
                const cond = this.lowerExpression(statement.getExpression(), scope);
                const thenBranch = this.lowerBranch(statement.getThenStatement(), scope);
                const otherwise = statement.getElseStatement();
                if (otherwise === undefined) return { kind: "if", cond, thenBranch };
                return { kind: "if", cond, thenBranch, elseBranch: this.lowerBranch(otherwise, scope) };
            }

            case SyntaxKind.WhileStatement: {
                const statement = node.asKindOrThrow(SyntaxKind.WhileStatement);
                return {
                    kind: "while",
                    cond: this.lowerExpression(statement.getExpression(), scope),
                    body: this.lowerBranch(statement.getStatement(), scope),
                };
            }

            case SyntaxKind.Block:
                return { kind: "block", body: this.lowerStatements(node, scope) };

            case SyntaxKind.ExpressionStatement: {
                const inner = node.asKindOrThrow(SyntaxKind.ExpressionStatement).getExpression();
                if (inner.getKind() === SyntaxKind.CallExpression) return this.lowerCallStatement(inner, scope);
                if (inner.getKind() === SyntaxKind.BinaryExpression) {
                    const assignment = this.lowerAssignment(inner, scope);
                    if (assignment) return assignment;
                }
                return { kind: "expr", expr: this.lowerExpression(inner, scope) };
            }
            case SyntaxKind.ReturnStatement: {
                const value = node.asKindOrThrow(SyntaxKind.ReturnStatement).getExpression();
                return value ? { kind: "return", value: this.lowerExpression(value, scope) } : { kind: "return" };
            }
            default:
                throw refuseAt(node, `${node.getKindName()} is not lowered yet`);
        }
    }

    /** A call in statement position discards its result; an engine function may still leave one behind. */
    private lowerCallStatement(node: Node, scope: Scope): Stmt {
        const call = node.asKindOrThrow(SyntaxKind.CallExpression);
        const callee = call.getExpression();
        if (callee.getKind() !== SyntaxKind.Identifier) throw refuseAt(callee, "only a plain callee is lowered yet");
        const name = callee.getText();
        const args = call.getArguments().map((argument) => this.lowerExpression(argument, scope));

        const fn = engineFunction(name, 2);
        if (fn) return { kind: "libStmt", opcode: fn.opcode, args, ...(fn.returns ? { popsResult: true } : {}) };

        const target = this.procedures.get(name);
        if (target === undefined) throw refuseAt(callee, `unknown procedure '${name}'`);
        return { kind: "callStmt", target: { kind: "procRef", index: target }, args };
    }

    private lowerBranch(node: Node, scope: Scope): Stmt {
        return this.lowerStatement(node, scope) ?? { kind: "block", body: [] };
    }

    /**
     * A local's slot is created at procedure entry, so a declaration emits an assignment only for an
     * initial value the slot could not hold directly - the same rule the SSL front end follows.
     */
    private lowerLocalDeclaration(node: Node, scope: Scope): Stmt | null {
        const assignments: Stmt[] = [];
        for (const decl of node.asKindOrThrow(SyntaxKind.VariableStatement).getDeclarationList().getDeclarations()) {
            const name = decl.getName();
            const initializer = decl.getInitializer();
            const literal = initializer ? this.literalOf(initializer) : ({ kind: "int", value: 0 } as const);
            const target = this.declareLocal(scope, name, literal ?? { kind: "int", value: 0 });
            if (literal === null && initializer) {
                assignments.push({ kind: "assign", target, op: "=", value: this.lowerExpression(initializer, scope) });
            }
        }
        if (assignments.length === 0) return null;
        return assignments.length === 1 ? (assignments[0] as Stmt) : { kind: "block", body: assignments };
    }

    /** An assignment written as a binary expression; anything else is an ordinary operator. */
    private lowerAssignment(node: Node, scope: Scope): Stmt | null {
        const binary = node.asKindOrThrow(SyntaxKind.BinaryExpression);
        const operator = binary.getOperatorToken().getText();
        const op = ASSIGN_OPS.get(operator);
        if (op === undefined) return null;
        const target = this.lowerExpression(binary.getLeft(), scope);
        if (target.kind !== "var") throw refuseAt(binary.getLeft(), "assignment target must be a variable");
        return { kind: "assign", target, op, value: this.lowerExpression(binary.getRight(), scope) };
    }

    private declareLocal(scope: Scope, name: string, initial: VariableDecl["initial"]): Extract<Expr, { kind: "var" }> {
        const target = this.currentProcedure;
        if (!target) throw new Error("local declared outside a procedure");
        const key = name.toLowerCase();
        const existing = scope.slots.get(key);
        if (existing !== undefined) return { kind: "var", scope: "local", index: existing, name };
        const index = scope.slots.size;
        scope.slots.set(key, index);
        target.locals.push({ name, initial });
        return { kind: "var", scope: "local", index, name };
    }

    /** The literal an initialiser folds to, or null when it needs code to compute. */
    private literalOf(node: Node): VariableDecl["initial"] | null {
        switch (node.getKind()) {
            case SyntaxKind.NumericLiteral:
            case SyntaxKind.StringLiteral: {
                const value = this.lowerExpression(node, { slots: new Map() });
                return value.kind === "int" || value.kind === "float" || value.kind === "string" ? value : null;
            }
            default:
                return null;
        }
    }

    private lowerExpression(node: Node, scope: Scope): Expr {
        switch (node.getKind()) {
            case SyntaxKind.Identifier: {
                const name = node.getText();
                const slot = scope.slots.get(name.toLowerCase());
                if (slot !== undefined) return { kind: "var", scope: "local", index: slot, name };
                const procedure = this.procedures.get(name);
                if (procedure !== undefined) return { kind: "procRef", index: procedure };
                throw refuseAt(node, `unknown identifier '${name}'`);
            }

            case SyntaxKind.ParenthesizedExpression:
                return this.lowerExpression(
                    node.asKindOrThrow(SyntaxKind.ParenthesizedExpression).getExpression(),
                    scope,
                );

            case SyntaxKind.BinaryExpression: {
                const binary = node.asKindOrThrow(SyntaxKind.BinaryExpression);
                const operator = binary.getOperatorToken().getText();
                const op = BINARY_OPS.get(operator);
                if (op === undefined) throw refuseAt(binary, `'${operator}' is not lowered yet`);
                return {
                    kind: "binary",
                    op,
                    left: this.lowerExpression(binary.getLeft(), scope),
                    right: this.lowerExpression(binary.getRight(), scope),
                };
            }

            case SyntaxKind.CallExpression: {
                const statement = this.lowerCallStatement(node, scope);
                if (statement.kind === "libStmt")
                    return { kind: "libCall", opcode: statement.opcode, args: statement.args };
                if (statement.kind === "callStmt")
                    return { kind: "call", target: statement.target, args: statement.args };
                throw refuseAt(node, "call is not usable as a value here");
            }

            case SyntaxKind.NumericLiteral: {
                const text = node.getText();
                const value = Number(text);
                // The spelling decides the type, as it does in SSL: `100.0` is a float, `100` an integer.
                return text.includes(".") || text.includes("e") || text.includes("E")
                    ? { kind: "float", value }
                    : { kind: "int", value };
            }
            case SyntaxKind.StringLiteral: {
                const value = node.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue();
                // Interned in WRITTEN order, which is what fixes the string table's layout.
                this.strings.push(value);
                return { kind: "string", value };
            }
            default:
                throw refuseAt(node, `${node.getKindName()} is not lowered yet`);
        }
    }
}
