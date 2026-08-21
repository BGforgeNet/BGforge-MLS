/**
 * TSSL straight to the compiler's IR, with no SSL text in between.
 *
 * The back end was built to take a tree from more than one front end - `compilers/ssl/src/int/ir.ts`
 * says so and names this one. What is left for a front end is resolving names to slots and walking its
 * own AST; the constructs whose expansion carries byte-exact invariants are not reimplemented here but
 * taken from `compilers/ssl/src/desugar.ts` - `for`, `foreach`, `switch` and array literals all lower
 * through its `Expansions`.
 *
 * **Incomplete by construction, and refusing is how it stays honest.** Every construct it does not yet
 * lower - `do`/`while`, `for-in`, `try` among them - is refused with the line it sits on rather than
 * approximated, so the coverage figure `pnpm tssl-int-diff` reports is the real one. Grow it against
 * that differential while the text route still exists to be compared with: once a mod stops committing
 * its generated `.ssl`, the only remaining check on this file is a digest that says a byte moved
 * without saying which construct moved it.
 *
 * Order is the constraint to respect when extending. The name table is built in declaration order and
 * its offsets are baked into the procedure table, so declarations must be produced in exactly the order
 * the text route's emitter renders them: forward declarations for every kept procedure, bundled modules
 * before the entry, then variables, then bodies.
 */

import { SyntaxKind, type FunctionDeclaration, type Node, type Project } from "ts-morph";
import type { BinaryOp, Declaration, Expr, ProcedureDecl, Program, Stmt, VariableDecl } from "../../../ssl/src/int/ir";
import { engineFunction } from "../../../ssl/src/int/engine-functions";
import { Expansions, type Desugarer, type Origin } from "../../../ssl/src/desugar";
import { buildProgramModel, refuseAt, type TsslProgram } from "../program-model";
import { sslName, type InlineFunc } from "../types";
import { createBatchState, prepareEntry, type TranspileBatchState } from "../batch";
import { extractInlineFunctions } from "../inline-functions";
// Generated from server/data/fallout-ssl-base.yml by generate-data.sh.
import engineProcedureNames from "../../../../server/out/fallout-ssl-engine-procedures.json";

/**
 * Builds the IR for one `.tssl` compilation unit. Throws a positioned refusal on anything unhandled.
 *
 * `batch` is what a caller compiling repeatedly passes to keep the ts-morph project between compiles,
 * which is the difference between a compile of over a second and one under 100 ms - see `../batch.ts`.
 * Without it each call stands up a TypeScript program of its own and throws it away.
 */
export function lowerTsslProgram(filePath: string, text: string, batch?: TranspileBatchState): Program {
    const state = batch ?? createBatchState();
    const entry = prepareEntry(state, filePath, text);
    const model = buildProgramModel(
        state.project,
        entry,
        filePath,
        engineProcedureNames,
        (source) => extractInlineFunctions(source, state.inlineFunctionCache),
        state.moduleWalkCache,
    );
    return new TsslLowering(model, state.project).lower();
}

/** Where a node sits, in the coordinates the shared expansions position their complaints with. */
function originOf(node: Node): Origin {
    return { line: node.getStartLineNumber(), column: 1 };
}

/** A procedure's locals, arguments first - the slot order the emitter and the engine both assume. */
interface Scope {
    slots: Map<string, number>;
    /**
     * An `@inline` macro's parameters bound to the caller's argument expressions, in force while its
     * expansion is lowered. Substitution is TEXTUAL in the route this mirrors, so a parameter is
     * replaced wherever it appears - including inside a compound operand like
     * `SCRIPT_REALNAME + ": " + msg`, which arrives as one operand and not as a bare parameter
     * reference. Checked before every other kind of name, as a preprocessor would.
     */
    bindings?: Map<string, Expr>;
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
    ["&&", "and"],
    ["||", "or"],
]);

/** Comments reach the statement walk as trivia nodes; they contribute nothing to the output. */
const COMMENT_KINDS = new Set([SyntaxKind.SingleLineCommentTrivia, SyntaxKind.MultiLineCommentTrivia]);

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
    /**
     * Declared parameter defaults per procedure slot. A call may omit trailing arguments whose
     * parameters declare one, and the default is supplied at the CALL SITE - so they have to be known
     * before any body is lowered, which is why the declaration pass records them.
     */
    private readonly paramDefaults = new Map<number, (VariableDecl["initial"] | null)[]>();
    private readonly strings: string[] = [];
    /**
     * Top-level `const` initialisers by name, and enum members by their flat `Enum_Member` name.
     *
     * The text route emits these as `#define`s, so the reference is a TEXTUAL substitution - which is
     * why the initialiser NODE is kept rather than a lowered value. Lowering it once and sharing the
     * result would intern a string constant once where the preprocessor interns it per use, and the
     * string table is built in use order, so every later offset would shift.
     */
    private readonly constants = new Map<string, Node>();
    /** Enum members whose value the declaration gives directly rather than through an initialiser. */
    private readonly enumValues = new Map<string, number | string>();
    /** Names generated temporaries `tmp.<n>`, counted across the whole unit as the SSL side does. */
    private tempCounter = 0;
    private scratchSeq = 0;
    /** Global slot per name. Allocated after every procedure, which is the order the text route emits. */
    private readonly globals = new Map<string, number>();
    /**
     * The four expansions with byte-exact invariants, shared with the SSL front end rather than
     * reimplemented here - which is the whole reason they were lifted out of its lowering.
     */
    private readonly expansions = new Expansions();
    /** The procedure a local declaration appends its slot to. */
    private currentProcedure: ProcedureDecl | null = null;
    private readonly model: TsslProgram;
    private readonly project: Project;

    constructor(model: TsslProgram, project: Project) {
        this.model = model;
        this.project = project;
    }

    lower(): Program {
        this.collectConstants();
        const kept = this.keptFunctions();
        // Forward declarations first: they allocate every procedure slot, and their order is the name
        // table's order.
        for (const func of kept) {
            const name = func.getName();
            if (name === undefined) continue;
            const index = this.declarations.length;
            this.procedures.set(name, index);
            const parameters = func.getParameters();
            this.paramDefaults.set(
                index,
                parameters.map((parameter) => {
                    const initial = parameter.getInitializer();
                    return initial ? this.constantOf(initial) : null;
                }),
            );
            this.declarations.push({
                kind: "procedure",
                procedure: { name, args: parameters.map((parameter) => parameter.getName()), locals: [], body: [] },
            });
        }
        // Globals take their name-table slots after every procedure, bundled modules before the entry -
        // the order the text route's emitter renders them, and the order the offsets are baked in.
        for (const module of this.model.modules) {
            for (const decl of module.lets) {
                if (!this.model.kept.has(decl)) continue;
                const initializer = decl.getInitializer();
                const initial = initializer ? this.constantOf(initializer) : null;
                if (initializer && initial === null) {
                    throw refuseAt(decl, "a global's initial value must be a literal");
                }
                this.globals.set(decl.getName().toLowerCase(), this.globals.size);
                this.declarations.push({
                    kind: "global",
                    variable: { name: decl.getName(), initial: initial ?? { kind: "int", value: 0 } },
                });
            }
        }
        for (const func of kept) this.lowerBody(func);
        return {
            declarations: this.declarations,
            ...(this.strings.length > 0 ? { stringLiterals: this.strings } : {}),
        };
    }

    /** Every module's `const`s and enum members, in module order so an earlier definition wins. */
    private collectConstants(): void {
        for (const module of this.model.modules) {
            for (const decl of module.consts) {
                const initializer = decl.getInitializer();
                if (initializer && !this.constants.has(decl.getName())) this.constants.set(decl.getName(), initializer);
            }
            for (const decl of module.enums) {
                for (const member of decl.getMembers()) {
                    const flat = `${decl.getName()}_${member.getName()}`;
                    const value = member.getValue();
                    this.enumValues.set(flat, value ?? 0);
                }
            }
        }
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

        const body = func.getBody();
        if (body === undefined) throw refuseAt(func, "a procedure with no body has nothing to lower");

        // Arguments occupy the first local slots, in declaration order, so locals index after them.
        const scope: Scope = { slots: new Map() };
        for (const parameter of func.getParameters()) {
            scope.slots.set(parameter.getName().toLowerCase(), scope.slots.size);
        }
        this.currentProcedure = entry.procedure;
        entry.procedure.body = this.lowerStatements(body, scope);
        this.currentProcedure = null;
    }

    private lowerStatements(block: Node, scope: Scope): Stmt[] {
        const out: Stmt[] = [];
        for (const statement of block.getChildrenOfKind(SyntaxKind.SyntaxList).flatMap((list) => list.getChildren())) {
            if (COMMENT_KINDS.has(statement.getKind())) continue;
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

            case SyntaxKind.BreakStatement:
                return { kind: "break" };
            case SyntaxKind.ContinueStatement:
                return { kind: "continue" };

            case SyntaxKind.ForOfStatement: {
                const loop = node.asKindOrThrow(SyntaxKind.ForOfStatement);
                const declared = loop.getInitializer().asKind(SyntaxKind.VariableDeclarationList);
                if (!declared) throw refuseAt(loop, "a for-of must declare its loop variable");
                const variable = declared.getDeclarations()[0];
                if (!variable) throw refuseAt(loop, "for-of has no loop variable");
                const subject = loop.getExpression();
                const body = loop.getStatement();

                // `for (const [k, v] of m)` walks an associative array: the pattern's two elements are
                // the key and the value, and the loop fetches them separately.
                const pattern = variable.getNameNode().asKind(SyntaxKind.ArrayBindingPattern);
                const bound = pattern
                    ? pattern.getElements().map((element) => {
                          const named = element.asKind(SyntaxKind.BindingElement);
                          if (!named) throw refuseAt(element, "a hole in a for-of pattern is not lowered yet");
                          return named.getNameNode();
                      })
                    : [variable.getNameNode()];
                const [firstName, secondName] = bound;
                if (!firstName) throw refuseAt(loop, "for-of has no loop variable");
                if (bound.length > 2) throw refuseAt(loop, "a for-of pattern takes at most a key and a value");
                // With one name it binds the VALUE; with two, the first is the key.
                const keyNode = secondName ? firstName : null;
                const valueNode = secondName ?? firstName;

                return this.expansions.foreach(this.hostFor(scope), {
                    origin: originOf(node),
                    declares: {
                        key: keyNode ? { text: keyNode.getText(), origin: originOf(keyNode) } : null,
                        value: { text: valueNode.getText(), origin: originOf(valueNode) },
                    },
                    subject: {
                        isVariable: subject.getKind() === SyntaxKind.Identifier,
                        get: () => this.lowerExpression(subject, scope),
                    },
                    key: keyNode ? () => this.lowerExpression(keyNode, scope) : null,
                    value: () => this.lowerExpression(valueNode, scope),
                    guard: null,
                    body: () => this.lowerBranch(body, scope),
                });
            }

            case SyntaxKind.SwitchStatement: {
                const statement = node.asKindOrThrow(SyntaxKind.SwitchStatement);
                const subject = statement.getExpression();
                const clauses = statement.getClauses();
                return this.expansions.switch(this.hostFor(scope), {
                    origin: originOf(node),
                    subject: {
                        // Always a temporary, never iterated in place. The route this must agree with
                        // renders `switch (X)` with the parentheses, so its parser sees a parenthesised
                        // expression rather than a bare name and allocates one even for a plain
                        // variable - and the temporary takes a slot, which shifts every later index.
                        isVariable: false,
                        get: () => this.lowerExpression(subject, scope),
                    },
                    cases: clauses
                        .filter((clause) => clause.getKind() === SyntaxKind.CaseClause)
                        .map((clause) => {
                            const cased = clause.asKindOrThrow(SyntaxKind.CaseClause);
                            return {
                                value: () => this.lowerExpression(cased.getExpression(), scope),
                                body: () => this.lowerClauseBody(cased.getStatements(), scope),
                            };
                        }),
                    fallback: (() => {
                        const otherwise = clauses.find((clause) => clause.getKind() === SyntaxKind.DefaultClause);
                        if (!otherwise) return null;
                        const cased = otherwise.asKindOrThrow(SyntaxKind.DefaultClause);
                        return () => this.lowerClauseBody(cased.getStatements(), scope);
                    })(),
                });
            }

            case SyntaxKind.ForStatement: {
                const loop = node.asKindOrThrow(SyntaxKind.ForStatement);
                const init = loop.getInitializer();
                const cond = loop.getCondition();
                const update = loop.getIncrementor();
                const body = loop.getStatement();
                return this.expansions.for(this.hostFor(scope), {
                    origin: originOf(node),
                    init: init ? () => this.lowerStatement(init, scope) : null,
                    cond: cond ? () => this.lowerExpression(cond, scope) : null,
                    update: update ? () => this.lowerStatement(update, scope) : null,
                    body: body ? () => this.lowerBranch(body, scope) : null,
                });
            }

            case SyntaxKind.VariableDeclarationList:
                return this.lowerLocalDeclaration(node, scope);

            case SyntaxKind.PostfixUnaryExpression:
            case SyntaxKind.PrefixUnaryExpression: {
                const step = this.incrementOf(node, scope);
                if (step) return step;
                return { kind: "expr", expr: this.lowerExpression(node, scope) };
            }

            case SyntaxKind.ExpressionStatement: {
                const inner = node.asKindOrThrow(SyntaxKind.ExpressionStatement).getExpression();
                const step = this.incrementOf(inner, scope);
                if (step) return step;
                if (inner.getKind() === SyntaxKind.CallExpression) return this.lowerCallStatement(inner, scope);
                if (inner.getKind() === SyntaxKind.BinaryExpression) {
                    const assignment = this.lowerAssignment(inner, scope);
                    if (assignment) return assignment;
                }
                return { kind: "expr", expr: this.lowerExpression(inner, scope) };
            }
            case SyntaxKind.ReturnStatement: {
                const value = node.asKindOrThrow(SyntaxKind.ReturnStatement).getExpression();
                // A bare `return;` returns zero rather than nothing: the language synthesises the value,
                // so it compiles to the same value-returning sequence as `return 0`.
                return {
                    kind: "return",
                    value: value ? this.lowerExpression(value, scope) : { kind: "int", value: 0 },
                };
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
        // The rename is applied FIRST: `import { atoi as base_atoi }` names an ambient engine function,
        // so looking the local alias up in the engine table would miss and fall through to a procedure
        // that does not exist.
        const name = this.calleeName(callee);

        // The callee is resolved BEFORE its arguments are lowered. An inline macro re-lowers its own
        // spliced text, so lowering the arguments first would intern their string literals twice and in
        // the wrong order - and the string table is built in intern order, which fixes every offset.
        // folib spells an array or map literal as a call; both are literals, not procedures.
        if (name === "list" || name === "map") {
            return { kind: "expr", expr: this.lowerListHelper(call, name === "map", scope) };
        }
        const inlineMacro = this.model.inlineFunctions.get(name);
        if (inlineMacro) {
            // Lowered as a STATEMENT rather than as an expression wrapped afterwards, so an expansion
            // that bottoms out in an engine call gets that call's own `popsResult` - and so a macro
            // expanding to another macro recurses here and resolves at whatever depth it ends.
            const parsed = this.expansionOf(inlineMacro, call.getArguments(), callee);
            if (parsed.getKind() === SyntaxKind.CallExpression) return this.lowerCallStatement(parsed, scope);
            return { kind: "expr", expr: this.lowerExpression(parsed, scope) };
        }

        const args = call.getArguments().map((argument) => this.lowerExpression(argument, scope));

        const fn = engineFunction(name.toLowerCase());
        if (fn) {
            const bound = this.withProcedureArgs(call, args, fn.procArgs ?? 0);
            // `popsResult`, NOT `returns`: the table keeps them apart deliberately - `returns` is what
            // the documented signature yields, `popsResult` is what the statement form actually discards.
            return { kind: "libStmt", opcode: fn.opcode, args: bound, ...(fn.popsResult ? { popsResult: true } : {}) };
        }

        const target = this.procedures.get(name);
        if (target === undefined) throw refuseAt(callee, `unknown procedure '${name}'`);
        return {
            kind: "callStmt",
            target: { kind: "procRef", index: target },
            args: this.padWithDefaults(target, args),
        };
    }

    /**
     * A switch clause's statements, without the `break` that ends it. SSL cases do not fall through, so
     * the target has nothing for a `break` to mean here - and left in place it would compile to a jump
     * out of the enclosing LOOP, which is a different statement entirely.
     */
    private lowerClauseBody(statements: Node[], scope: Scope): Stmt[] {
        const body = statements.filter((statement) => statement.getKind() !== SyntaxKind.BreakStatement);
        const out: Stmt[] = [];
        for (const statement of body) {
            const lowered = this.lowerStatement(statement, scope);
            if (lowered) out.push(lowered);
        }
        return out;
    }

    /**
     * A branch is always a block. The route this must agree with renders every branch as
     * `begin ... end`, so the tree it parses back has a block even where the author wrote one bare
     * statement - and a bare statement here would be a different tree and different bytes.
     */
    private lowerBranch(node: Node, scope: Scope): Stmt {
        const lowered = this.lowerStatement(node, scope);
        if (lowered === null) return { kind: "block", body: [] };
        return lowered.kind === "block" ? lowered : { kind: "block", body: [lowered] };
    }

    /**
     * A local's slot is created at procedure entry, so a declaration emits an assignment only for an
     * initial value the slot could not hold directly - the same rule the SSL front end follows.
     */
    private lowerLocalDeclaration(node: Node, scope: Scope): Stmt | null {
        const assignments: Stmt[] = [];
        const statement = node.asKind(SyntaxKind.VariableStatement);
        const list = statement?.getDeclarationList() ?? node.asKindOrThrow(SyntaxKind.VariableDeclarationList);
        // A bare declaration list reaches here only as a `for` initializer, where SSL holds exactly one
        // declarator. Refused rather than lowered: the text route has to put the extras somewhere else,
        // and wherever it puts them they take different slots than they do here.
        if (!statement && list.getDeclarations().length > 1) {
            throw refuseAt(node, "a for initializer declares one variable; declare the others before the loop");
        }
        for (const decl of list.getDeclarations()) {
            // The text route refuses this too; a binding pattern here would declare a local named after
            // the pattern text. The key/value form a for-of takes never reaches this method.
            if (decl.getNameNode().getKind() !== SyntaxKind.Identifier) {
                throw refuseAt(decl, "destructuring is not supported; declare each variable separately");
            }
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

    /** `i++` / `i--` in statement position, which is what a `for` update usually is. */
    private incrementOf(node: Node, scope: Scope): Stmt | null {
        const postfix = node.asKind(SyntaxKind.PostfixUnaryExpression);
        const prefix = postfix ? undefined : node.asKind(SyntaxKind.PrefixUnaryExpression);
        const operator = postfix?.getOperatorToken() ?? prefix?.getOperatorToken();
        if (operator !== SyntaxKind.PlusPlusToken && operator !== SyntaxKind.MinusMinusToken) return null;
        const operand = postfix?.getOperand() ?? prefix?.getOperand();
        if (!operand) return null;
        const target = this.lowerExpression(operand, scope);
        if (target.kind !== "var") throw refuseAt(operand, "increment target must be a variable");
        return {
            kind: "assign",
            target,
            op: operator === SyntaxKind.PlusPlusToken ? "+=" : "-=",
            value: { kind: "int", value: 1 },
        };
    }

    /** An assignment written as a binary expression; anything else is an ordinary operator. */
    private lowerAssignment(node: Node, scope: Scope): Stmt | null {
        const binary = node.asKindOrThrow(SyntaxKind.BinaryExpression);
        const operator = binary.getOperatorToken().getText();
        const op = ASSIGN_OPS.get(operator);
        if (op === undefined) return null;

        // `arr[key] = value` writes through the engine; there is no slot to assign to.
        const element = binary.getLeft().asKind(SyntaxKind.ElementAccessExpression);
        if (element) {
            if (op !== "=") throw refuseAt(binary, `'${operator}' on an array element is not lowered yet`);
            const index = element.getArgumentExpression();
            if (!index) throw refuseAt(element, "element assignment has no index");
            const call = this.engineCall(element, "set_array", [
                this.lowerExpression(element.getExpression(), scope),
                this.lowerExpression(index, scope),
                this.lowerExpression(binary.getRight(), scope),
            ]);
            if (call.kind !== "libCall") throw refuseAt(element, "set_array did not lower to an engine call");
            return { kind: "libStmt", opcode: call.opcode, args: call.args };
        }

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

    /**
     * The initial value a LOCAL slot is born with. Only a bare literal qualifies: anything else -
     * including a NEGATED literal - is left as zero and assigned where the declaration appears. Global
     * scope differs and folds a negation into the slot, which is why the two readers are separate.
     */
    private literalOf(node: Node): VariableDecl["initial"] | null {
        switch (node.getKind()) {
            case SyntaxKind.ParenthesizedExpression:
                return this.literalOf(node.asKindOrThrow(SyntaxKind.ParenthesizedExpression).getExpression());
            case SyntaxKind.NumericLiteral:
            case SyntaxKind.StringLiteral:
            case SyntaxKind.TrueKeyword:
            case SyntaxKind.FalseKeyword: {
                const value = this.lowerExpression(node, { slots: new Map() });
                return value.kind === "int" || value.kind === "float" || value.kind === "string" ? value : null;
            }
            default:
                return null;
        }
    }

    /** As `literalOf`, but for the places that DO fold a negation: a global's slot and a param default. */
    private constantOf(node: Node): VariableDecl["initial"] | null {
        const unary = node.asKind(SyntaxKind.PrefixUnaryExpression);
        if (unary && unary.getOperatorToken() === SyntaxKind.MinusToken) {
            const inner = this.constantOf(unary.getOperand());
            if (inner?.kind === "int") return { kind: "int", value: -inner.value };
            if (inner?.kind === "float") return { kind: "float", value: -inner.value };
            return null;
        }
        return this.literalOf(node);
    }

    /** This front end's side of the shared expansions' contract, bound to one procedure's scope. */
    private hostFor(scope: Scope): Desugarer {
        return {
            declareLocal: (name, initial) => this.declareLocal(scope, name, initial),
            newTemp: () => this.declareLocal(scope, `tmp.${this.tempCounter++}`, { kind: "int", value: 0 }),
            engineCall: (name, args) => {
                const fn = engineFunction(name);
                if (!fn) throw new Error(`engine function '${name}' is unavailable`);
                return { kind: "libCall", opcode: fn.opcode, args };
            },
            // This front end refuses rather than collecting, so there is no stand-in to carry on with.
            report: (message) => {
                throw new Error(message);
            },
        };
    }

    /**
     * The name a local import binding actually declares. `import { atoi as base_atoi }` calls the
     * declaration, not the local alias, and the rename map is kept per importing module.
     */
    private declaredName(node: Node, name: string): string {
        return this.model.importRenames.get(node.getSourceFile())?.get(name) ?? name;
    }

    /**
     * A callee's name as the output spells it: the declaration behind a renamed import, then the SSL
     * spelling of that declaration. Resolving the rename FIRST is what makes `import { sfall_typeof as
     * vt }` reach the same name a direct call does.
     */
    private calleeName(callee: Node): string {
        return sslName(this.declaredName(callee, callee.getText()));
    }

    /**
     * Expands an `@inline` function into the call it stands for.
     *
     * Substitution is TEXTUAL, deliberately, because the route this must agree with expands these as
     * `#define` macros through the C preprocessor. An argument is spliced in WITHOUT parentheses, so
     * precedence re-associates across the boundary: `ndebug("a " + x)` against
     * `#define ndebug(msg) debug_msg(NAME + ": " + msg)` yields `((NAME + ": ") + "a ") + x`, not
     * `(NAME + ": ") + ("a " + x)`. The two compute the same string and compile to different bytes, and
     * matching the bytes is what keeps an emitted `.ssl` guaranteed to compile to what we emit directly.
     * Substituting the caller's parsed subtree instead would be the hygienic reading and is a change to
     * make deliberately, not by accident.
     */
    private expansionOf(inline: InlineFunc, actual: Node[], at: Node): Node {
        const substitution = new Map<string, string>();
        inline.params.forEach((parameter, position) => {
            const supplied = actual[position];
            if (supplied) substitution.set(parameter, supplied.getText());
        });
        const args = inline.args.map((argument) => {
            if (argument.type === "param") return substitution.get(argument.value) ?? argument.value;
            // `source`, not `value`: the latter has already been converted to SSL spelling, which is not
            // TypeScript once an operator has changed (`|` becomes `bwor`).
            return this.substituteParams(argument.source ?? argument.value, substitution, at);
        });
        return this.parseExpression(`${inline.targetFunc}(${args.join(", ")})`, at);
    }

    /**
     * Replaces parameter names in a macro operand's source text. Driven by the parser's identifier
     * positions rather than by a regex, so a parameter name occurring inside a string literal or as a
     * property name is left alone - which is what makes this a token substitution and not a text one.
     */
    private substituteParams(text: string, substitution: Map<string, string>, at: Node): string {
        if (substitution.size === 0) return text;
        const parsed = this.parseExpression(text, at);
        const offset = parsed.getStart();
        const self = parsed.getKind() === SyntaxKind.Identifier ? [parsed.asKindOrThrow(SyntaxKind.Identifier)] : [];
        const replacements = [...parsed.getDescendantsOfKind(SyntaxKind.Identifier), ...self]
            .filter((identifier) => substitution.has(identifier.getText()))
            .map((identifier) => ({
                start: identifier.getStart() - offset,
                end: identifier.getEnd() - offset,
                with: substitution.get(identifier.getText()) as string,
            }))
            .sort((a, b) => b.start - a.start);
        let out = text;
        for (const replacement of replacements) {
            out = out.slice(0, replacement.start) + replacement.with + out.slice(replacement.end);
        }
        return out;
    }

    /**
     * Parses one expression's source text through the checker's own parser.
     *
     * The wrapping parenthesis is unwrapped before returning, so the result's `getStart()` lines up with
     * index 0 of `text` - which is what lets `substituteParams` splice by parsed identifier position.
     */
    private parseExpression(text: string, at: Node): Node {
        const scratch = this.project.createSourceFile(`__inline-${this.scratchSeq++}.ts`, `const __v = (${text});`, {
            overwrite: true,
        });
        const wrapper = scratch
            .getVariableDeclarations()[0]
            ?.getInitializer()
            ?.asKind(SyntaxKind.ParenthesizedExpression);
        const inner = wrapper?.getExpression();
        if (!inner) throw refuseAt(at, `cannot parse inline operand '${text}'`);
        return inner;
    }

    /** Trailing arguments the call omitted, taken from the callee's declared defaults. */
    private padWithDefaults(procedure: number, args: Expr[]): Expr[] {
        const defaults = this.paramDefaults.get(procedure) ?? [];
        const padded = [...args];
        for (let position = padded.length; position < defaults.length; position++) {
            const fallback = defaults[position];
            if (!fallback) break;
            padded.push(fallback);
        }
        return padded;
    }

    /** `list(a, b)` and `map({...})` build the same literals the bracket forms do. */
    private lowerListHelper(call: Node, isMap: boolean, scope: Scope): Expr {
        const args = call.asKindOrThrow(SyntaxKind.CallExpression).getArguments();
        const sole = args[0];
        if (isMap) {
            if (sole) return this.lowerExpression(sole, scope);
            // `map<K, V>()` with no entries is still a map literal, just an empty one.
            return this.expansions.arrayLiteral(this.hostFor(scope), {
                origin: originOf(call),
                isMap: true,
                entries: [],
            });
        }
        return this.expansions.arrayLiteral(this.hostFor(scope), {
            origin: originOf(call),
            isMap: false,
            entries: args.map((argument) => ({ key: null, value: () => this.lowerExpression(argument, scope) })),
        });
    }

    /**
     * Replaces the arguments in procedure-taking slots with a reference rather than a call. A slot
     * declared to take a procedure resolves procedures ahead of variables; anywhere else the same bare
     * name CALLS it, so the position is what decides.
     */
    private withProcedureArgs(call: Node, args: Expr[], procArgs: number): Expr[] {
        if (procArgs === 0) return args;
        const written = call.asKindOrThrow(SyntaxKind.CallExpression).getArguments();
        return args.map((argument, index) => {
            if ((procArgs & (1 << index)) === 0) return argument;
            const node = written[index];
            if (!node || node.getKind() !== SyntaxKind.Identifier) return argument;
            const procedure = this.procedures.get(this.declaredName(node, node.getText()));
            return procedure === undefined ? argument : { kind: "procRef", index: procedure };
        });
    }

    private engineCall(at: Node, name: string, args: Expr[]): Expr {
        const fn = engineFunction(name);
        if (!fn) throw refuseAt(at, `engine function '${name}' is unavailable`);
        return { kind: "libCall", opcode: fn.opcode, args };
    }

    /** A map key. A bare word is the string it spells, as the object-literal syntax means it. */
    private lowerMapKey(name: Node, scope: Scope): Expr {
        // `{[expr]: v}` wraps its key; the brackets say the key is computed, not that it is a name.
        const computed = name.asKind(SyntaxKind.ComputedPropertyName);
        if (computed) return this.lowerExpression(computed.getExpression(), scope);
        if (name.getKind() === SyntaxKind.Identifier) {
            const text = name.getText();
            this.strings.push(text);
            return { kind: "string", value: text };
        }
        return this.lowerExpression(name, scope);
    }

    /** An enum member's declared value. A string member interns like any other string constant. */
    private valueOf(value: number | string): Expr {
        if (typeof value === "number") {
            return Number.isInteger(value) ? { kind: "int", value } : { kind: "float", value };
        }
        this.strings.push(value);
        return { kind: "string", value };
    }

    private lowerExpression(node: Node, scope: Scope): Expr {
        switch (node.getKind()) {
            case SyntaxKind.TrueKeyword:
                return { kind: "int", value: 1 };
            case SyntaxKind.FalseKeyword:
                return { kind: "int", value: 0 };

            case SyntaxKind.Identifier: {
                const name = node.getText();
                const bound = scope.bindings?.get(name);
                if (bound) return bound;
                // Locals first, so a parameter or local shadows a module constant as TypeScript scoping
                // says it does.
                const slot = scope.slots.get(name.toLowerCase());
                if (slot !== undefined) return { kind: "var", scope: "local", index: slot, name };
                const constant = this.constants.get(name);
                if (constant !== undefined) return this.lowerExpression(constant, scope);
                const flat = this.enumValues.get(name);
                if (flat !== undefined) return this.valueOf(flat);
                const global = this.globals.get(name.toLowerCase());
                if (global !== undefined) return { kind: "var", scope: "global", index: global, name };
                // An engine function with no arguments is written without parentheses. These are lexer
                // keywords, so they take precedence over a user name that happens to match.
                const engine = engineFunction(name.toLowerCase());
                if (engine) return { kind: "libCall", opcode: engine.opcode, args: [] };
                // A bare procedure name in expression position CALLS it with no arguments rather than
                // yielding its index.
                const procedure = this.procedures.get(name);
                if (procedure !== undefined) {
                    return {
                        kind: "call",
                        target: { kind: "procRef", index: procedure },
                        args: this.padWithDefaults(procedure, []),
                    };
                }
                throw refuseAt(node, `unknown identifier '${name}'`);
            }

            // `Enum.Member`, which the text route flattens to an `Enum_Member` define.
            case SyntaxKind.PropertyAccessExpression: {
                const access = node.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
                const flat = `${access.getExpression().getText()}_${access.getName()}`;
                const value = this.enumValues.get(flat);
                if (value !== undefined) return this.valueOf(value);
                const constant = this.constants.get(flat);
                if (constant !== undefined) return this.lowerExpression(constant, scope);
                throw refuseAt(node, `unknown enum member '${flat}'`);
            }

            // Type syntax carries no value: `x as number`, `x satisfies T` and `x!` are all their operand.
            case SyntaxKind.AsExpression:
                return this.lowerExpression(node.asKindOrThrow(SyntaxKind.AsExpression).getExpression(), scope);
            case SyntaxKind.SatisfiesExpression:
                return this.lowerExpression(node.asKindOrThrow(SyntaxKind.SatisfiesExpression).getExpression(), scope);
            case SyntaxKind.NonNullExpression:
                return this.lowerExpression(node.asKindOrThrow(SyntaxKind.NonNullExpression).getExpression(), scope);

            case SyntaxKind.PrefixUnaryExpression: {
                const unary = node.asKindOrThrow(SyntaxKind.PrefixUnaryExpression);
                const operand = unary.getOperand();
                switch (unary.getOperatorToken()) {
                    case SyntaxKind.MinusToken:
                        // NOT folded here. In an expression `-1` is a push and a NEGATE, where a folded
                        // constant would be one push - different bytes. Folding happens only in
                        // `constantOf`, where an initial value is required to be constant.
                        return { kind: "unary", op: "negate", operand: this.lowerExpression(operand, scope) };
                    case SyntaxKind.PlusToken:
                        return this.lowerExpression(operand, scope);
                    case SyntaxKind.ExclamationToken:
                        return { kind: "unary", op: "not", operand: this.lowerExpression(operand, scope) };
                    case SyntaxKind.TildeToken:
                        return { kind: "unary", op: "bwnot", operand: this.lowerExpression(operand, scope) };
                    default:
                        throw refuseAt(unary, `prefix '${unary.getOperatorToken()}' is not lowered yet`);
                }
            }

            case SyntaxKind.ArrayLiteralExpression: {
                const literal = node.asKindOrThrow(SyntaxKind.ArrayLiteralExpression);
                return this.expansions.arrayLiteral(this.hostFor(scope), {
                    origin: originOf(node),
                    isMap: false,
                    entries: literal.getElements().map((element) => ({
                        key: null,
                        value: () => this.lowerExpression(element, scope),
                    })),
                });
            }

            case SyntaxKind.ObjectLiteralExpression: {
                const literal = node.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
                return this.expansions.arrayLiteral(this.hostFor(scope), {
                    origin: originOf(node),
                    isMap: true,
                    entries: literal.getProperties().map((property) => {
                        const assignment = property.asKind(SyntaxKind.PropertyAssignment);
                        if (!assignment) throw refuseAt(property, "only `key: value` entries are lowered yet");
                        const name = assignment.getNameNode();
                        const value = assignment.getInitializer();
                        if (!value) throw refuseAt(property, "map entry has no value");
                        return {
                            key: () => this.lowerMapKey(name, scope),
                            value: () => this.lowerExpression(value, scope),
                        };
                    }),
                });
            }

            // `arr[i]` reads through the engine rather than by address.
            case SyntaxKind.ElementAccessExpression: {
                const access = node.asKindOrThrow(SyntaxKind.ElementAccessExpression);
                const index = access.getArgumentExpression();
                if (!index) throw refuseAt(access, "element access has no index");
                return this.engineCall(access, "get_array", [
                    this.lowerExpression(access.getExpression(), scope),
                    this.lowerExpression(index, scope),
                ]);
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
                // A macro or a `list()`/`map()` helper lowers straight to a value.
                if (statement.kind === "expr") return statement.expr;
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
