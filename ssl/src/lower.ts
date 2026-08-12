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
    "andalso",
    "orelse",
    "bwand",
    "bwor",
    "bwxor",
]);

const ASSIGN_OPS = new Set<string>(["=", ":=", "+=", "-=", "*=", "/="]);

/** Marks a literal built inside another array expression, and the terminator that closes one. */
const ARRAY_FLAG_EXPR_PUSH = 32;
const ARRAY_FLAG_EXPR_POP = 64;

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
    /**
     * Names generated temporaries `tmp.<n>`. The counter runs across the whole compilation unit rather
     * than per procedure, and the dot keeps the name out of the user identifier space.
     */
    private tempCounter = 0;
    /** Declared parameter defaults per procedure index, used to pad a short call. */
    private readonly paramDefaults = new Map<number, (VariableDecl["initial"] | null)[]>();
    /** Depth of nested array/map literals; a nested one is flagged and terminated differently. */
    private arrayNesting = 0;
    private currentTarget: ProcedureDecl | null = null;

    constructor(options: LowerOptions) {
        this.game = options.game ?? 2;
    }

    lower(root: SyntaxNode): Program {
        this.collect(root);
        this.lowerBodies(root);
        return { declarations: this.declarations, stringLiterals: collectStringLiterals(root) };
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
                    this.recordParameters(child);
                    if (this.procedures.has(name.toLowerCase())) break;
                    this.procedures.set(name.toLowerCase(), this.procedures.size);
                    const modifier = child.childForFieldName("modifier")?.text.toLowerCase();
                    this.declarations.push({
                        kind: "procedure",
                        procedure: {
                            name,
                            args: [],
                            locals: [],
                            body: [],
                            ...(modifier === "pure" ? { pure: true } : {}),
                            ...(modifier === "inline" ? { inline: true } : {}),
                        },
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

    /**
     * Parameter defaults are read from whichever declaration states them - a forward declaration and
     * the definition may each carry some - because a call supplying fewer arguments is padded with
     * them at the CALL SITE, so they must be known before any body is lowered.
     */
    private recordParameters(node: SyntaxNode): void {
        const params = node.childForFieldName("params");
        if (!params) return;
        const key = this.nameOf(node).toLowerCase();
        const index = this.procedures.get(key) ?? this.procedures.size;
        const existing = this.paramDefaults.get(index) ?? [];
        const defaults: (VariableDecl["initial"] | null)[] = [];
        let position = 0;
        for (const param of params.namedChildren) {
            if (!param || param.type !== "param") continue;
            const declared = param.childForFieldName("default");
            defaults.push(declared ? this.constantOf(declared) : (existing[position] ?? null));
            position++;
        }
        this.paramDefaults.set(index, defaults);
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
            // `param_default` is a wrapper around the actual literal node.
            case "param_default":
            case "paren_expr":
            case "param_default_group": {
                const inner = node.namedChildren.find((c) => c && c.type !== "comment");
                if (inner) return this.constantOf(inner);
                break;
            }
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
            case "param_default_unary":
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

    /**
     * The initial value a LOCAL slot is born with. Only a bare literal qualifies, parentheses aside:
     * anything else - including a negated literal - is left as zero and assigned where the declaration
     * appears, which is what the reference does. Global scope differs and folds a negation into the
     * slot, so the two cannot share `constantOf`.
     */
    private literalOf(node: SyntaxNode): VariableDecl["initial"] | null {
        switch (node.type) {
            case "number":
            case "string":
            case "boolean":
                return this.constantOf(node);
            case "paren_expr": {
                const inner = node.namedChildren.find((c) => c && c.type !== "comment");
                return inner ? this.literalOf(inner) : null;
            }
        }
        return null;
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

        // Slots are allocated during this walk, in source order, rather than in a hoisting pre-pass.
        // Generated temporaries are interleaved with declared locals in the reference, so collecting
        // declarations first would renumber every slot after a `foreach`.
        this.currentTarget = target;
        target.body = this.lowerEach(body, scope);
        this.currentTarget = null;

        if (node.children.some((c) => c?.type === "critical")) target.critical = true;
        const modifier = node.childForFieldName("modifier")?.text.toLowerCase();
        if (modifier === "pure") target.pure = true;
        if (modifier === "inline") target.inline = true;
    }

    /** Allocates the next local slot. Its initial value is pushed at procedure entry, in slot order. */
    private declareLocal(scope: Scope, name: string, initial: VariableDecl["initial"]): Expr {
        const target = this.currentTarget;
        if (!target) throw new Error("local declared outside a procedure");
        const key = name.toLowerCase();
        const existing = scope.slots.get(key);
        if (existing !== undefined) return { kind: "var", scope: "local", index: existing, name };
        const index = scope.slots.size;
        scope.slots.set(key, index);
        target.locals.push({ name, initial });
        return { kind: "var", scope: "local", index, name };
    }

    private newTemp(scope: Scope): Expr {
        return this.declareLocal(scope, `tmp.${this.tempCounter++}`, { kind: "int", value: 0 });
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
            case "comment":
            case "line_comment":
            case "empty_statement":
                return null;

            // The slot itself is created at procedure entry, so a declaration emits code only when its
            // initial value is not a literal the slot could hold directly.
            case "variable_decl":
                return this.lowerLocalDeclaration(node, scope);

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

            case "for_stmt":
                return this.lowerFor(node, scope);

            case "foreach_stmt":
                return this.lowerForeach(node, scope);

            case "switch_stmt":
                return this.lowerSwitch(node, scope);

            case "return_stmt": {
                const value = node.namedChildren.find((c) => c && c.type !== "comment" && c.type !== "line_comment");
                // A bare `return;` returns zero rather than nothing: the language synthesises the value,
                // so it compiles to the same value-returning sequence as `return 0`.
                return {
                    kind: "return",
                    value: value ? this.lowerExpression(value, scope) : { kind: "int", value: 0 },
                };
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

    /**
     * `for` is not a loop form of its own. It becomes the initialiser followed by a while whose body
     * ends with a loop-end marker and then the update, which is what makes `continue` run the update
     * before retesting the condition.
     *
     * An absent condition is not "loop forever" by omission - the reference requires the expression, so
     * a missing one is a source error rather than something to substitute a default for.
     */
    private lowerFor(node: SyntaxNode, scope: Scope): Stmt {
        const init = node.childForFieldName("init");
        const cond = node.childForFieldName("cond");
        const update = node.childForFieldName("update");
        const body = node.childForFieldName("body");
        if (!cond) throw new LowerError("for loop has no condition", node);

        // Lowering order is the reference's PARSE order - init, condition, update, then body - because
        // slots are allocated as they are encountered, so a different order here renumbers them.
        const initStmt = init ? this.lowerForClause(init, scope) : null;
        const condition = this.lowerExpression(cond, scope);
        const updateStmt = update ? this.lowerForClause(update, scope) : null;

        const inner: Stmt[] = [];
        if (body) inner.push(this.lowerBranchNode(body, scope));
        inner.push({ kind: "loopEnd" });
        if (updateStmt) inner.push(updateStmt);

        const loop: Stmt = { kind: "while", cond: condition, body: { kind: "block", body: inner } };
        return initStmt ? { kind: "block", body: [initStmt, loop] } : loop;
    }

    /**
     * `foreach v in arr do body` walks an array by index. It expands to:
     *
     *     count := 0;  len := len_array(arr);
     *     while (count < len) do begin
     *         key := array_key(arr, count);
     *         v   := get_array(arr, key);
     *         body
     *         LOOP_END
     *         count += 1;
     *     end
     *
     * Three details are load-bearing for the output rather than cosmetic. The subject is evaluated into
     * a temporary UNLESS it is already a plain variable, so a call is not re-evaluated per iteration.
     * The temporaries are allocated in a fixed order - subject, len, count, then the key when the source
     * named none - because that order fixes both their `tmp.<n>` names and their slot indices. And the
     * key is fetched separately from the value so the same expansion serves associative arrays, where
     * the index and the key differ.
     */
    private lowerForeach(node: SyntaxNode, scope: Scope): Stmt {
        const iter = node.childForFieldName("iter");
        const body = node.childForFieldName("body");
        if (!iter) throw new LowerError("foreach has no iterable", node);

        // The parenthesised form puts a lone variable in the `key` field, so the value is whichever of
        // the two is present last.
        const keyField = node.childForFieldName("key");
        const valueField = node.childForFieldName("value");
        const varField = node.childForFieldName("var");
        const valueName = valueField ?? varField ?? keyField;
        const keyName = valueField ? keyField : null;
        if (!valueName) throw new LowerError("foreach has no loop variable", node);

        const declares = node.children.some((c) => c?.type === "variable");
        const statements: Stmt[] = [];

        // Allocation order is the reference's PARSE order, and it decides both the `tmp.<n>` names and
        // every local slot index: the loop variables are declared as they are read, before `in` and so
        // before any temporary exists. Allocating the temporaries first shifts every later slot by one.
        if (declares) {
            if (keyName) this.declareLocal(scope, keyName.text, { kind: "int", value: 0 });
            this.declareLocal(scope, valueName.text, { kind: "int", value: 0 });
        }

        // A bare variable is iterated in place; anything else is evaluated once into a temporary.
        let subject: Expr;
        if (iter.type === "identifier") {
            subject = this.reference(iter, scope);
        } else {
            subject = this.newTemp(scope);
            if (subject.kind !== "var") throw new LowerError("temporary is not a variable", node);
            statements.push({ kind: "assign", target: subject, op: "=", value: this.lowerExpression(iter, scope) });
        }

        const len = this.newTemp(scope);
        const count = this.newTemp(scope);
        const key = keyName ? this.reference(keyName, scope) : this.newTemp(scope);
        const value = this.reference(valueName, scope);
        if (len.kind !== "var" || count.kind !== "var" || key.kind !== "var" || value.kind !== "var") {
            throw new LowerError("foreach loop variable is not a variable", node);
        }

        const call = (name: string, args: Expr[]): Expr => this.engineCall(node, name, args);

        statements.push(
            { kind: "assign", target: count, op: "=", value: { kind: "int", value: 0 } },
            { kind: "assign", target: len, op: "=", value: call("len_array", [subject]) },
        );

        let condition: Expr = { kind: "binary", op: "<", left: count, right: len };
        const guard = node.childForFieldName("while_cond");
        if (guard) {
            condition = { kind: "binary", op: "and", left: condition, right: this.lowerExpression(guard, scope) };
        }

        const inner: Stmt[] = [
            { kind: "assign", target: key, op: "=", value: call("array_key", [subject, count]) },
            { kind: "assign", target: value, op: "=", value: call("get_array", [subject, key]) },
        ];
        if (body) inner.push(this.lowerBranchNode(body, scope));
        inner.push({ kind: "loopEnd" }, { kind: "assign", target: count, op: "+=", value: { kind: "int", value: 1 } });

        statements.push({ kind: "while", cond: condition, body: { kind: "block", body: inner } });
        return { kind: "block", body: statements };
    }

    /**
     * `switch` is a nested if/else-if chain over equality comparisons, not a jump table. The subject is
     * evaluated into a temporary unless it is already a plain variable, so it is tested once per case
     * without being recomputed.
     *
     * There is no fallthrough to model: each case's statements are its own branch, and `default`
     * becomes the innermost else.
     */
    private lowerSwitch(node: SyntaxNode, scope: Scope): Stmt {
        const value = node.childForFieldName("value");
        if (!value) throw new LowerError("switch has no subject", node);

        const statements: Stmt[] = [];
        let subject: Expr;
        if (value.type === "identifier") {
            subject = this.reference(value, scope);
        } else {
            subject = this.newTemp(scope);
            if (subject.kind !== "var") throw new LowerError("temporary is not a variable", node);
            statements.push({ kind: "assign", target: subject, op: "=", value: this.lowerExpression(value, scope) });
        }

        const cases = node.namedChildren.filter((c): c is SyntaxNode => c?.type === "case_clause");
        if (cases.length === 0) throw new LowerError("switch statement with no cases", node);
        const fallback = node.namedChildren.find((c): c is SyntaxNode => c?.type === "default_clause");

        // Built innermost-first so each case's else holds the chain below it.
        let chain: Stmt | undefined = fallback
            ? { kind: "block", body: this.lowerClauseBody(fallback, scope) }
            : undefined;
        for (let index = cases.length - 1; index >= 0; index--) {
            const clause = cases[index] as SyntaxNode;
            const caseValue = clause.childForFieldName("value");
            if (!caseValue) throw new LowerError("case has no value", clause);
            const branch: Stmt = {
                kind: "if",
                cond: { kind: "binary", op: "==", left: subject, right: this.lowerExpression(caseValue, scope) },
                thenBranch: { kind: "block", body: this.lowerClauseBody(clause, scope) },
            };
            chain = chain ? { ...branch, elseBranch: chain } : branch;
        }

        statements.push(chain as Stmt);
        return statements.length === 1 ? (statements[0] as Stmt) : { kind: "block", body: statements };
    }

    /**
     * A clause's statements are everything except its `value` field. The comparison is by node id:
     * each accessor call returns a fresh wrapper object, so identity comparison silently keeps the
     * value and then tries to lower it as a statement.
     */
    private lowerClauseBody(clause: SyntaxNode, scope: Scope): Stmt[] {
        const valueId = clause.childForFieldName("value")?.id;
        const body = clause.namedChildren.filter((c): c is SyntaxNode => c !== null && c.id !== valueId);
        return this.lowerEach(body, scope);
    }

    /** The init and update clauses carry their own node types, none of which end in a semicolon. */
    private lowerForClause(node: SyntaxNode, scope: Scope): Stmt | null {
        switch (node.type) {
            case "for_var_decl":
            case "for_init_assign": {
                const name = node.childForFieldName("name");
                const value = node.childForFieldName("value");
                if (!name || !value) throw new LowerError("malformed for clause", node);
                const literal = node.type === "for_var_decl" ? this.literalOf(value) : null;
                if (node.type === "for_var_decl") {
                    this.declareLocal(scope, name.text, literal ?? { kind: "int", value: 0 });
                }
                // A declaring init follows the local-declaration rule: a literal is folded into the
                // slot at procedure entry, so no assignment is emitted here for it.
                if (literal !== null) return null;
                const target = this.reference(name, scope);
                if (target.kind !== "var") throw new LowerError("for target must be a variable", name);
                return { kind: "assign", target, op: "=", value: this.lowerExpression(value, scope) };
            }
            case "for_update_assign": {
                const left = node.childForFieldName("left");
                const right = node.childForFieldName("right");
                if (!left || !right) throw new LowerError("malformed for update", node);
                const target = this.lowerExpression(left, scope);
                if (target.kind !== "var") throw new LowerError("for update target must be a variable", left);
                const operator = node.children.find((c) => c && ASSIGN_OPS.has(c.text))?.text ?? "=";
                return {
                    kind: "assign",
                    target,
                    op: (operator === ":=" ? "=" : operator) as AssignOp,
                    value: this.lowerExpression(right, scope),
                };
            }
        }
        // `for (...; ...; i++)` - the update clause is the other place an increment appears.
        return this.incrementOf(node, scope) ?? { kind: "expr", expr: this.lowerExpression(node, scope) };
    }

    /**
     * A local declaration emits an assignment only for an initial value the slot could not hold - the
     * slot itself was already created, with zero, at procedure entry. One declaration can introduce
     * several variables, so this can yield more than one assignment.
     */
    private lowerLocalDeclaration(node: SyntaxNode, scope: Scope): Stmt | null {
        const assignments: Stmt[] = [];
        for (const init of node.namedChildren) {
            if (!init || init.type !== "var_init") continue;
            const name = init.childForFieldName("name");
            if (!name) throw new LowerError("var_init has no name", init);
            const value = init.childForFieldName("value");
            const literal = value ? this.literalOf(value) : ({ kind: "int", value: 0 } as const);
            const target = this.declareLocal(scope, name.text, literal ?? { kind: "int", value: 0 });
            if (!value || literal !== null) continue;
            if (target.kind !== "var") throw new LowerError(`'${name.text}' is not a variable`, name);
            assignments.push({ kind: "assign", target, op: "=", value: this.lowerExpression(value, scope) });
        }
        if (assignments.length === 0) return null;
        return assignments.length === 1 ? (assignments[0] as Stmt) : { kind: "block", body: assignments };
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
        const operator = node.children.find((c) => c && ASSIGN_OPS.has(c.text))?.text ?? "=";
        const op = (operator === ":=" ? "=" : operator) as AssignOp;

        // Assigning into an array or map is a `set_array` call, not a store: the outermost `get_array`
        // of the access chain becomes a `set_array` with the value appended.
        if (left.type === "subscript_expr" || left.type === "member_expr") {
            if (op !== "=") {
                throw new LowerError(`compound assignment to an element is not lowered yet`, node);
            }
            const object = left.childForFieldName("object");
            const index =
                left.type === "subscript_expr" ? left.childForFieldName("index") : left.childForFieldName("member");
            if (!object || !index) throw new LowerError("malformed element assignment", left);
            const key: Expr =
                left.type === "subscript_expr"
                    ? this.lowerExpression(index, scope)
                    : { kind: "string", value: index.text };
            const fn = engineFunction("set_array", this.game);
            if (!fn) throw new LowerError("engine function 'set_array' is unavailable", node);
            return {
                kind: "libStmt",
                opcode: fn.opcode,
                args: [this.lowerExpression(object, scope), key, this.lowerExpression(right, scope)],
                ...(fn.popsResult ? { popsResult: true } : {}),
            };
        }

        const target = this.lowerExpression(left, scope);
        if (target.kind !== "var") throw new LowerError("assignment target must be a variable", left);
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
            const { callee, args, checkArgCount } = this.callParts(target, scope);
            return { kind: "callStmt", target: callee, args, ...(checkArgCount ? { checkArgCount } : {}) };
        }
        const callee = this.procedureRef(target, scope);
        return {
            kind: "callStmt",
            target: callee,
            args: [],
            ...(callee.kind === "procRef" ? {} : { checkArgCount: true }),
        };
    }

    /**
     * A bare expression statement is either an engine function used for its effect or a procedure call
     * whose result is discarded; the two compile differently, so the callee decides.
     */
    private lowerExpressionStatement(node: SyntaxNode, scope: Scope): Stmt {
        const increment = this.incrementOf(node, scope);
        if (increment) return increment;
        if (node.type === "call_expr") {
            const callee = node.childForFieldName("func");
            if (callee?.type === "identifier") {
                const engine = engineFunction(callee.text.toLowerCase(), this.game);
                if (engine) {
                    const args = this.argumentsOf(node, scope, engine.procArgs);
                    const statement: Stmt = { kind: "libStmt", opcode: engine.opcode, args };
                    return engine.popsResult ? { ...statement, popsResult: true } : statement;
                }
            }
            const { callee: target, args, checkArgCount } = this.callParts(node, scope);
            return { kind: "callStmt", target, args, ...(checkArgCount ? { checkArgCount } : {}) };
        }
        return { kind: "expr", expr: this.lowerExpression(node, scope) };
    }

    /**
     * `x++` is compound assignment spelled differently, and is a statement rather than an expression -
     * it appears both on its own and as a `for` update clause, so both paths route through here.
     */
    private incrementOf(node: SyntaxNode, scope: Scope): Stmt | null {
        if (node.type !== "unary_expr") return null;
        const op = node.childForFieldName("op")?.text;
        if (op !== "++" && op !== "--") return null;
        const operand = node.childForFieldName("expr");
        if (!operand) throw new LowerError("malformed increment", node);
        const target = this.lowerExpression(operand, scope);
        if (target.kind !== "var") throw new LowerError("increment target must be a variable", operand);
        return { kind: "assign", target, op: op === "++" ? "+=" : "-=", value: { kind: "int", value: 1 } };
    }

    private callParts(node: SyntaxNode, scope: Scope): { callee: Expr; args: Expr[]; checkArgCount: boolean } {
        const func = node.childForFieldName("func");
        if (!func) throw new LowerError("call has no callee", node);
        const callee = this.procedureRef(func, scope);
        const args = this.argumentsOf(node, scope);
        if (callee.kind !== "procRef") {
            // The target is only known at run time, so the engine checks the argument count instead.
            return { callee, args, checkArgCount: true };
        }
        // A call may omit trailing arguments that declare a default; the default is supplied here.
        const defaults = this.paramDefaults.get(callee.index) ?? [];
        for (let position = args.length; position < defaults.length; position++) {
            const fallback = defaults[position];
            if (!fallback) break;
            args.push(fallback);
        }
        return { callee, args, checkArgCount: false };
    }

    /**
     * `procArgs` marks argument positions that take a PROCEDURE rather than a value. A procedure named
     * there is passed by reference; the same name anywhere else calls it, so the position decides.
     */
    private argumentsOf(node: SyntaxNode, scope: Scope, procArgs = 0): Expr[] {
        // namedChildren[0] is the callee; comments can appear between arguments.
        const args = node.namedChildren
            .slice(1)
            .filter((c): c is SyntaxNode => Boolean(c) && c.type !== "comment" && c.type !== "line_comment");
        return args.map((argument, index) => {
            if ((procArgs & (1 << index)) !== 0 && argument.type === "identifier") {
                const procedure = this.procedures.get(argument.text.toLowerCase());
                if (procedure !== undefined) return { kind: "procRef", index: procedure };
            }
            return this.lowerExpression(argument, scope);
        });
    }

    /**
     * The target of a call. A named procedure is called by index; a VARIABLE holding a procedure is
     * fetched and resolved at run time, which is how a callback stored in a variable is invoked.
     */
    private procedureRef(node: SyntaxNode, scope: Scope): Expr {
        if (node.type !== "identifier") throw new LowerError(`cannot call a '${node.type}'`, node);
        const key = node.text.toLowerCase();
        const index = this.procedures.get(key);
        if (index !== undefined) return { kind: "procRef", index };
        const slot = scope.slots.get(key);
        if (slot !== undefined) return { kind: "var", scope: "local", index: slot, name: node.text };
        const global = this.globals.get(key);
        if (global !== undefined) return { kind: "var", scope: "global", index: global, name: node.text };
        const external = this.externals.get(key);
        if (external !== undefined) return { kind: "var", scope: "external", index: 0, name: external };
        throw new LowerError(`unknown procedure '${node.text}'`, node);
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

            // Both index and field access read through the same engine call; a field name is just a
            // string key, and chains nest one call inside the next.
            case "subscript_expr": {
                const object = node.childForFieldName("object");
                const index = node.childForFieldName("index");
                if (!object || !index) throw new LowerError("malformed subscript", node);
                return this.engineCall(node, "get_array", [
                    this.lowerExpression(object, scope),
                    this.lowerExpression(index, scope),
                ]);
            }

            case "member_expr": {
                const object = node.childForFieldName("object");
                const member = node.childForFieldName("member");
                if (!object || !member) throw new LowerError("malformed member access", node);
                return this.engineCall(node, "get_array", [
                    this.lowerExpression(object, scope),
                    { kind: "string", value: member.text },
                ]);
            }

            case "array_expr":
                return this.lowerArrayLiteral(node, scope, false);

            case "map_expr":
                return this.lowerArrayLiteral(node, scope, true);

            case "call_expr": {
                const func = node.childForFieldName("func");
                if (func?.type === "identifier") {
                    const engine = engineFunction(func.text.toLowerCase(), this.game);
                    if (engine) {
                        return {
                            kind: "libCall",
                            opcode: engine.opcode,
                            args: this.argumentsOf(node, scope, engine.procArgs),
                        };
                    }
                }
                const { callee, args, checkArgCount } = this.callParts(node, scope);
                return { kind: "call", target: callee, args, ...(checkArgCount ? { checkArgCount } : {}) };
            }
        }
        throw new LowerError(`unsupported expression '${node.type}'`, node);
    }

    /**
     * Array and map literals build their value by SUMMING engine calls rather than by any dedicated
     * instruction: a `temp_array` seed plus one `arrayexpr(key, value)` term per entry, added
     * left to right. An array numbers its own keys from zero; a map takes the written key.
     *
     * The seed's size argument distinguishes the two (0 for an array, -1 for a map), and its flags
     * argument marks a NESTED literal, which additionally emits a terminator so the engine's expression
     * stack unwinds. Nesting depth is therefore part of the emitted code, not just a parsing concern.
     */
    private lowerArrayLiteral(node: SyntaxNode, scope: Scope, isMap: boolean): Expr {
        this.arrayNesting++;
        try {
            const nested = this.arrayNesting > 1;
            const seed = this.engineCall(node, "temp_array", [
                { kind: "int", value: isMap ? -1 : 0 },
                { kind: "int", value: nested ? ARRAY_FLAG_EXPR_PUSH : 0 },
            ]);

            let result: Expr = seed;
            const add = (term: Expr): void => {
                result = { kind: "binary", op: "+", left: result, right: term };
            };

            if (isMap) {
                for (const entry of node.namedChildren) {
                    if (!entry || entry.type !== "map_entry") continue;
                    const key = entry.childForFieldName("key");
                    const value = entry.childForFieldName("value");
                    if (!key || !value) throw new LowerError("malformed map entry", entry);
                    add(
                        this.engineCall(node, "arrayexpr", [
                            this.lowerExpression(key, scope),
                            this.lowerExpression(value, scope),
                        ]),
                    );
                }
            } else {
                let index = 0;
                for (const element of node.namedChildren) {
                    if (!element || element.type === "comment" || element.type === "line_comment") continue;
                    add(
                        this.engineCall(node, "arrayexpr", [
                            { kind: "int", value: index++ },
                            this.lowerExpression(element, scope),
                        ]),
                    );
                }
            }

            if (nested) {
                add(
                    this.engineCall(node, "temp_array", [
                        { kind: "int", value: 0 },
                        { kind: "int", value: ARRAY_FLAG_EXPR_POP },
                    ]),
                );
            }
            return result;
        } finally {
            this.arrayNesting--;
        }
    }

    private engineCall(node: SyntaxNode, name: string, args: Expr[]): Expr {
        const fn = engineFunction(name, this.game);
        if (!fn) throw new LowerError(`engine function '${name}' is unavailable`, node);
        return { kind: "libCall", opcode: fn.opcode, args };
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
        // An engine function with no arguments is written without parentheses. These are lexer
        // keywords, so they take precedence over a user name that happens to match.
        const engine = engineFunction(key, this.game);
        if (engine) return { kind: "libCall", opcode: engine.opcode, args: [] };
        // A bare procedure name in expression position CALLS it with no arguments rather than yielding
        // its index - `@name` is the spelling that yields the index.
        const procedure = this.procedures.get(key);
        if (procedure !== undefined) return { kind: "call", target: { kind: "procRef", index: procedure }, args: [] };
        throw new LowerError(`unknown identifier '${node.text}'`, node);
    }
}

/**
 * String constants in the order the source writes them, which is the order the table is built in.
 * A pre-order walk of the tree is exactly that order, since children are stored by position - unlike a
 * walk of the lowered IR, whose conditional stores its condition before the value written ahead of it.
 *
 * A field access contributes its member name, which becomes a string constant even though the source
 * never quotes it.
 */
function collectStringLiterals(root: SyntaxNode): string[] {
    const out: string[] = [];
    const visit = (node: SyntaxNode): void => {
        if (node.type === "string") out.push(unquote(node.text));
        for (const child of node.namedChildren) {
            if (!child) continue;
            if (node.type === "member_expr" && child.id === node.childForFieldName("member")?.id) {
                out.push(child.text);
                continue;
            }
            visit(child);
        }
    };
    visit(root);
    return out;
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
