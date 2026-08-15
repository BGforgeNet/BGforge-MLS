/**
 * Lowers a parsed SSL syntax tree to the INT emitter's IR.
 *
 * Two passes. The first walks the top level in source order and collects every declaration, because the
 * name table is built in that order and its offsets are baked into the output. The second lowers each
 * procedure body against a scope built from that collection.
 *
 * Anything the lowering does not handle is refused rather than approximated: a wrong instruction
 * produces a script that misbehaves in-game, where a reported error is a gap someone can close. A
 * mistake in the SOURCE is collected and the walk continues, so one attempt finds all of them; a
 * disagreement between the grammar and this file throws, because there is no stand-in that would let
 * the walk carry on meaningfully.
 */

import type { Node as SyntaxNode, Tree } from "web-tree-sitter";
import { engineFunction } from "./int/engine-functions";
import { Op } from "./int/opcodes";
import type {
    AssignOp,
    BinaryOp,
    Declaration,
    Expr,
    ProcedureDecl,
    Program,
    Stmt,
    UndefinedProcedure,
    VariableDecl,
} from "./int/ir";

export class LowerError extends Error {
    readonly line: number;
    readonly column: number;
    /** The complaint without the `line:column:` prefix, so an aggregate can be rebuilt from one of these. */
    readonly detail: string;
    /**
     * Every problem this lowering found, this one first.
     *
     * A caller that can only show one error shows this one and reads exactly as it did before lowering
     * learned to collect them; one that can show more reads the list. Nothing is emitted while the list
     * is non-empty, so collecting cannot change what a script compiles to - only how much of what is
     * wrong with it you learn per attempt.
     */
    readonly all: readonly LowerError[];

    /**
     * `at` is normally the node that is wrong. An aggregate passes a bare position instead: it has to
     * carry the FIRST error's location, and the tree those nodes came from is deleted as soon as the
     * compile unwinds, so holding one would outlive it.
     */
    constructor(detail: string, at: SyntaxNode | { line: number; column: number }, all: readonly LowerError[] = []) {
        const line = "startPosition" in at ? at.startPosition.row + 1 : at.line;
        const column = "startPosition" in at ? at.startPosition.column + 1 : at.column;
        super(`${line}:${column}: ${detail}`);
        this.name = "LowerError";
        this.line = line;
        this.column = column;
        this.detail = detail;
        this.all = all.length > 0 ? all : [this];
    }
}

/** How many complaints one lowering reports before it gives up collecting. */
const MAX_ERRORS = 100;

/**
 * What a reported expression lowers to so the walk can continue past it.
 *
 * Nothing is emitted while there are diagnostics, so this value never reaches an output file; its only
 * job is to be a well-formed `Expr` that the rest of lowering can consume without special-casing.
 */
const POISON: Expr = { kind: "int", value: 0 };

/**
 * The statement form of the same stand-in. An empty block emits nothing, so a reported statement leaves
 * no trace in the walk beyond having been counted.
 */
const POISON_STMT: Stmt = { kind: "block", body: [] };

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

/** The literal nodes a constant expression may end in. */
const LITERALS = new Set<string>(["number", "string", "char", "boolean"]);

/** The comparison operators, which take one comparison rather than a chain of them. */
const COMPARISONS = new Set<string>(["==", "!=", "<", ">", "<=", ">="]);

/** Whether a node is a literal zero, in any spelling the language writes one. */
function isZeroLiteral(node: SyntaxNode): boolean {
    if (node.type === "paren_expr") {
        const inner = node.namedChildren.find((c) => c && c.type !== "comment");
        return inner ? isZeroLiteral(inner) : false;
    }
    if (node.type === "boolean") return node.text.toLowerCase() === "false";
    if (node.type !== "number") return false;
    const text = node.text;
    const radix = text.startsWith("0x") || text.startsWith("0X") ? 16 : 10;
    return (text.includes(".") ? Number.parseFloat(text) : Number.parseInt(text, radix)) === 0;
}

/** Process-control statements to their core opcode. `noop` is absent: it emits nothing at all. */
const PROCESS_OPCODES: Record<string, number> = {
    spawn: Op.SPAWN,
    callstart: Op.CALLSTART,
    exec: Op.EXEC,
    fork: Op.FORK,
    wait: Op.WAIT,
    cancel: Op.CANCEL,
    cancelall: Op.CANCELALL,
    exit: Op.EXIT,
    detach: Op.DETACH,
    startcritical: Op.STARTCRITICAL,
    endcritical: Op.ENDCRITICAL,
};

/**
 * The engine functions the optimiser may drop the call to when nothing reads the result.
 *
 * Five of them, which is what the reference treats as side-effect-free; everything else is assumed to do
 * something. Held as opcodes because that is what a lowered call carries.
 */
const PURE_LIB_OPCODES: ReadonlySet<number> = new Set(
    ["len_array", "atoi", "atof", "get_tile_fid", "modified_ini"]
        .map((name) => engineFunction(name)?.opcode)
        .filter((opcode): opcode is number => opcode !== undefined),
);

/** Builds an engine call, marking the few whose result is all they produce. */
function libCall(opcode: number, args: Expr[]): Expr {
    return { kind: "libCall", opcode, args, ...(PURE_LIB_OPCODES.has(opcode) ? { pure: true } : {}) };
}

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
    /** Where each procedure slot was first named, so an undefined one can be reported at its declaration. */
    private readonly declaredAt = new Map<number, SyntaxNode>();
    /** Procedure slots declared `inline`, which may be called but never used as a value. */
    private readonly inlineProcedures = new Set<number>();
    /** Procedures declared `pure`, whose calls the optimiser may drop when nothing reads the result. */
    private readonly pureProcedures = new Set<number>();
    private readonly undefinedProcedures: UndefinedProcedure[] = [];
    /** Depth of nested array/map literals; a nested one is flagged and terminated differently. */
    private arrayNesting = 0;
    /**
     * Enclosing loops. `break` emits a bare jump that consumes the exit address a loop left on the stack,
     * so outside one it jumps somewhere arbitrary rather than failing - the reference rejects it, and
     * accepting it silently would ship a script that misbehaves in-game.
     */
    private loopDepth = 0;
    private currentTarget: ProcedureDecl | null = null;

    constructor(options: LowerOptions) {
        this.game = options.game ?? 2;
    }

    /**
     * User errors found so far. A site that reports through here returns a stand-in and lets the walk
     * carry on, so one attempt finds everything wrong with a script rather than its first mistake.
     *
     * Only sites established as reachable by a CLEAN parse report this way. The rest still throw: they
     * fire when the grammar and this file disagree, which is a defect here rather than in the script, and
     * continuing past one would carry a poison value into code with no reason to expect it.
     */
    private readonly diagnostics: LowerError[] = [];
    /** Unresolved names already reported, so one misspelling used thirty times is one complaint. */
    private readonly reportedNames = new Set<string>();

    /** Records a user error and yields the stand-in that lets lowering continue. */
    private report(detail: string, node: SyntaxNode): Expr {
        const error = new LowerError(detail, node);
        if (this.diagnostics.length < MAX_ERRORS && !this.diagnostics.some((d) => d.message === error.message)) {
            this.diagnostics.push(error);
        }
        return POISON;
    }

    lower(root: SyntaxNode): Program {
        try {
            this.collect(root);
            this.lowerBodies(root);
        } catch (error) {
            // A site that still throws stops the walk, but it must not discard what was already found:
            // otherwise converting sites one at a time would make a script report FEWER problems than it
            // did before, depending on which mistake happened to come first.
            if (!(error instanceof LowerError) || this.diagnostics.length === 0) throw error;
            this.diagnostics.push(error);
        }
        const first = this.diagnostics[0];
        if (first) throw new LowerError(first.detail, { line: first.line, column: first.column }, this.diagnostics);
        return {
            declarations: this.declarations,
            stringLiterals: collectStringLiterals(root),
            ...(hasShortCircuitPragma(root) ? { shortCircuit: true } : {}),
            ...(this.undefinedProcedures.length > 0 ? { undefinedProcedures: this.undefinedProcedures } : {}),
        };
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
                    this.checkModifiers(child);
                    if (this.procedures.has(name.toLowerCase())) this.checkRedeclaration(child, name);
                    this.recordParameters(child);
                    if (this.procedures.has(name.toLowerCase())) break;
                    this.declaredAt.set(this.procedures.size, child);
                    this.procedures.set(name.toLowerCase(), this.procedures.size);
                    const modifier = child.childForFieldName("modifier")?.text.toLowerCase();
                    if (modifier === "inline") this.inlineProcedures.add(this.procedures.size - 1);
                    if (modifier === "pure") this.pureProcedures.add(this.procedures.size - 1);
                    this.declarations.push({
                        kind: "procedure",
                        procedure: {
                            name,
                            args: [],
                            locals: [],
                            body: [],
                            ...(modifier === "pure" ? { pure: true } : {}),
                            ...(modifier === "inline" ? { inline: true } : {}),
                            ...(child.childForFieldName("critical") ? { critical: true } : {}),
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
     * What a second declaration of the same procedure may say. The parameter list must match the first
     * one's length, and the defaults belong to the FIRST declaration alone - restating them on the
     * definition is refused rather than merged, so there is only ever one statement of what a call pads.
     */
    private checkRedeclaration(node: SyntaxNode, name: string): void {
        const params = node.childForFieldName("params");
        if (!params) return;
        const declared = params.namedChildren.filter((c): c is SyntaxNode => Boolean(c) && c.type === "param");
        const first = this.paramDefaults.get(this.procedures.get(name.toLowerCase()) ?? -1);
        if (first && declared.length !== first.length) {
            this.report(`'${name}' was declared with ${first.length} parameters`, params);
        }
        const withDefault = declared.find((param) => param.childForFieldName("default"));
        if (withDefault) {
            this.report(`'${name}' is already declared; its defaults belong to that declaration`, withDefault);
        }
    }

    /**
     * The modifier combinations the language refuses. `inline` is the awkward one: it pastes a body into
     * its caller, so there is no procedure left to schedule, to forward-declare, or to return from.
     */
    private checkModifiers(node: SyntaxNode): void {
        const modifier = node.childForFieldName("modifier")?.text.toLowerCase();
        const scheduled = node.childForFieldName("timed") ?? node.childForFieldName("condition");
        if (scheduled && (modifier === "pure" || modifier === "inline")) {
            this.report(`a timed or conditional procedure cannot be '${modifier}'`, scheduled);
        }
        if (modifier === "inline" && node.type === "procedure_forward") {
            this.report("an inline procedure cannot be forward-declared", node);
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
        // A call may only omit a TRAILING run of arguments, so once a parameter carries a default every
        // parameter after it must too - otherwise the call site cannot tell which one was left out.
        let optionalSeen = false;
        for (const param of params.namedChildren) {
            if (!param || param.type !== "param") continue;
            const declared = param.childForFieldName("default");
            if (declared) optionalSeen = true;
            // `existing` carries defaults a forward declaration stated; one there covers this position
            // too. Absent is `undefined` when nothing was declared and `null` when it was left blank.
            else if (optionalSeen && !existing[position]) {
                this.report("a parameter with a default cannot precede one without", param);
            }
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
        const size = init.childForFieldName("size");
        // Only a local may be declared as an array: the creation is a statement, and a global's
        // declaration has no procedure to run it in. Accepting it would give the slot no array at all.
        if (size) this.report("array declarations are only allowed on a local variable", size);
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
            case "char": {
                const value = charConstant(node);
                // The grammar accepts any single escape; only the ones in the table have a value.
                if (value === null) {
                    this.report(`unknown escape '${node.text.slice(1, -1)}' in a character constant`, node);
                    return { kind: "int", value: 0 };
                }
                return { kind: "int", value };
            }
            case "boolean":
                return { kind: "int", value: node.text.toLowerCase() === "true" ? 1 : 0 };
            case "param_default_unary":
            case "unary_expr": {
                const operand = node.childForFieldName("expr");
                const op = node.childForFieldName("op")?.text.toLowerCase();
                // One operator, applied to a LITERAL. The language reads any parentheses before the
                // operator, so `((-7))` is a constant expression and `-(7)` is not one at all - and
                // neither is `- -7`, since what follows the operator must be the constant itself.
                if (operand && !LITERALS.has(operand.type)) break;
                if (operand && (op === "-" || op === "not" || op === "bwnot")) {
                    const inner = this.constantOf(operand);
                    // `not` and `bwnot` yield an integer whatever they are given: a float is truncated
                    // first, which is what the reference does with the same three operators here.
                    if (inner.kind === "int" || inner.kind === "float") {
                        const truncated = Math.trunc(inner.value);
                        if (op === "not") return { kind: "int", value: truncated === 0 ? 1 : 0 };
                        if (op === "bwnot") return { kind: "int", value: ~truncated };
                        return inner.kind === "int"
                            ? { kind: "int", value: -inner.value }
                            : { kind: "float", value: -inner.value };
                    }
                }
                break;
            }
        }
        this.report(`initial value must be a literal, got ${node.type}`, node);
        return { kind: "int", value: 0 };
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
            case "char":
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
        const defined = new Set<number>();
        for (const child of root.namedChildren) {
            if (!child || child.type !== "procedure") continue;
            const index = this.procedures.get(this.nameOf(child).toLowerCase());
            const entry = index === undefined ? undefined : byIndex[index];
            if (entry?.kind !== "procedure") continue;
            if (index !== undefined) defined.add(index);
            this.lowerProcedure(child, entry.procedure);
        }

        // A forward declaration allocates its slot with an empty body, so a name never defined would
        // otherwise emit a procedure that returns immediately - every call to it silently doing nothing.
        // The language has no way to define one elsewhere: there is no import form for procedures, only
        // for variables, so within a translation unit a declaration without a definition is always a
        // defect in the source. Recorded rather than thrown here: the emitter is what refuses, and only
        // for the ones dead-code elimination has not already removed.
        for (const [index, node] of this.declaredAt) {
            if (defined.has(index)) continue;
            const entry = byIndex[index];
            this.undefinedProcedures.push({
                index,
                name: entry?.kind === "procedure" ? entry.procedure.name : "?",
                line: node.startPosition.row + 1,
                column: node.startPosition.column + 1,
            });
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

        const modifier = node.childForFieldName("modifier")?.text.toLowerCase();
        if (modifier === "pure") target.pure = true;
        if (modifier === "inline") target.inline = true;
        // A forward declaration and its definition may each carry the modifier; either one sets the bit.
        if (node.childForFieldName("critical")) target.critical = true;

        // `procedure foo in <n>` fires at a fixed time, so the operand goes in the procedure table and must
        // be a constant. The engine reads that field as an unsigned deadline, so a non-integer fires at once -
        // refusing where the reference does not is deliberate.
        const timed = node.childForFieldName("timed");
        if (timed) {
            const value = this.lowerExpression(timed, scope);
            if (value.kind === "int") target.timed = value.value;
            else this.report("a timed procedure's delay must be an integer", timed);
        }

        // `procedure foo when <expr>` compiles the guard as a separate code block the engine calls to
        // decide whether to run the body, so it is lowered outside the body's statement list.
        const condition = node.childForFieldName("condition");
        if (condition) target.conditional = this.lowerExpression(condition, scope);
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

            case "while_stmt": {
                const cond = this.required(node, "cond", scope);
                return { kind: "while", cond, body: this.inLoop(() => this.branch(node, "body", scope)) };
            }

            case "for_stmt":
                return this.inLoop(() => this.lowerFor(node, scope));

            case "foreach_stmt":
                return this.inLoop(() => this.lowerForeach(node, scope));

            case "switch_stmt":
                return this.lowerSwitch(node, scope);

            case "return_stmt": {
                // An inline body is pasted into its caller, so a return in it would return from the
                // CALLER. The language refuses it rather than picking one of the two meanings.
                if (this.currentTarget?.inline) {
                    this.report("an inline procedure cannot return", node);
                    return null;
                }
                const value = node.namedChildren.find((c) => c && c.type !== "comment" && c.type !== "line_comment");
                // A bare `return;` returns zero rather than nothing: the language synthesises the value,
                // so it compiles to the same value-returning sequence as `return 0`.
                return {
                    kind: "return",
                    value: value ? this.lowerExpression(value, scope) : { kind: "int", value: 0 },
                };
            }

            case "process_stmt":
                return this.lowerProcessStatement(node, scope);

            case "break_stmt":
                this.requireLoop(node, "break");
                return { kind: "break" };

            case "continue_stmt":
                this.requireLoop(node, "continue");
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

            // The only directive that survives preprocessing is `#pragma`, which is read off the whole
            // tree rather than from where it sits, and emits nothing here.
            case "preprocessor":
                return null;
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

        // Lowering order is the reference's PARSE order - init, condition, update, then body - because
        // slots are allocated as they are encountered, so a different order here renumbers them.
        const initStmt = init ? this.lowerForClause(init, scope) : null;
        const condition = cond ? this.lowerExpression(cond, scope) : this.report("for loop has no condition", node);
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
        // A loop the source did not declare names existing variables, so either name can be something
        // else entirely; the temporaries above are variables by construction.
        if (key.kind !== "var" || value.kind !== "var") {
            const offender = key.kind === "var" ? value : key;
            if (offender !== POISON) this.report("foreach loop variable is not a variable", node);
            return { kind: "block", body: statements };
        }
        if (len.kind !== "var" || count.kind !== "var") {
            throw new LowerError("temporary is not a variable", node);
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
        // A lone `default` does not qualify: the language wants at least one case, so the whole
        // statement is refused rather than reduced to its fallback.
        if (cases.length === 0) this.report("switch statement with no cases", node);
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

        if (chain) statements.push(chain);
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
                if (target.kind !== "var") {
                    if (target !== POISON) this.report("for target must be a variable", name);
                    return null;
                }
                return { kind: "assign", target, op: "=", value: this.lowerExpression(value, scope) };
            }
            case "for_update_assign": {
                const left = node.childForFieldName("left");
                const right = node.childForFieldName("right");
                if (!left || !right) throw new LowerError("malformed for update", node);
                const target = this.lowerExpression(left, scope);
                if (target.kind !== "var") {
                    if (target !== POISON) this.report("for update target must be a variable", left);
                    return null;
                }
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
            const size = init.childForFieldName("size");
            const literal = value ? this.literalOf(value) : ({ kind: "int", value: 0 } as const);
            const target = this.declareLocal(scope, name.text, literal ?? { kind: "int", value: 0 });
            // `variable a[10]` declares a slot AND fills it: the declaration carries an assignment of a
            // fresh temp array. Flags default to 4 - the value the language uses when they are left out.
            if (size) {
                if (target.kind !== "var") throw new LowerError(`'${name.text}' is not a variable`, name);
                const flags = init.childForFieldName("flags");
                assignments.push({
                    kind: "assign",
                    target,
                    op: "=",
                    value: this.engineCall(init, "temp_array", [
                        this.lowerExpression(size, scope),
                        flags ? this.lowerExpression(flags, scope) : { kind: "int", value: 4 },
                    ]),
                });
                continue;
            }
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

    private lowerAssignment(node: SyntaxNode, scope: Scope): Stmt | null {
        const left = node.childForFieldName("left");
        const right = node.childForFieldName("right");
        if (!left || !right) throw new LowerError("malformed assignment", node);
        const operator = node.children.find((c) => c && ASSIGN_OPS.has(c.text))?.text ?? "=";
        const op = (operator === ":=" ? "=" : operator) as AssignOp;

        if (left.type === "subscript_expr" || left.type === "member_expr") {
            return this.elementAssignment(left, op, () => this.lowerExpression(right, scope), scope);
        }

        const target = this.lowerExpression(left, scope);
        // An already-reported target must not produce a second complaint: `nope := 1` for an undeclared
        // `nope` is one mistake, and "assignment target must be a variable" describes the stand-in rather
        // than anything the author wrote.
        if (target === POISON) return null;
        // A procedure's name reaches here, and the reference accepts it: it stores into the local frame at
        // an offset the frame does not reach, so the engine's write lands on whatever else is on its stack.
        if (target.kind !== "var") {
            this.report("assignment target must be a variable", left);
            return null;
        }
        return { kind: "assign", target, op, value: this.lowerExpression(right, scope) };
    }

    /**
     * Assigning into an array or map is a `set_array` call, not a store: the outermost `get_array` of
     * the access chain becomes a `set_array` with the value appended. `a[k]++` steps an element through
     * here too, which is why the value arrives as a thunk - it is produced at the point the reference
     * produces it, after any temporaries the index needed have been allocated.
     */
    private elementAssignment(left: SyntaxNode, op: AssignOp, value: () => Expr, scope: Scope): Stmt {
        {
            const node = left;
            const object = left.childForFieldName("object");
            const index =
                left.type === "subscript_expr" ? left.childForFieldName("index") : left.childForFieldName("member");
            if (!object || !index) throw new LowerError("malformed element assignment", left);
            let key: Expr =
                left.type === "subscript_expr"
                    ? this.lowerExpression(index, scope)
                    : { kind: "string", value: index.text };
            let container = this.lowerExpression(object, scope);
            const fn = engineFunction("set_array", this.game);
            if (!fn) throw new LowerError("engine function 'set_array' is unavailable", node);
            const popsResult = fn.popsResult ? { popsResult: true } : {};

            if (op === "=") {
                return {
                    kind: "libStmt",
                    opcode: fn.opcode,
                    args: [container, key, value()],
                    ...popsResult,
                };
            }

            // `a[k] += v` is `set_array(a, k, get_array(a, k) + v)`, so the container and the key are
            // each read twice. Re-emitting a literal or a variable fetch is free and observationally
            // identical, but any other expression would RUN twice - a call index would fire twice - so
            // it is evaluated once into a temporary and the temporary is what gets duplicated.
            const prelude: Stmt[] = [];
            const evaluateOnce = (expr: Expr): Expr => {
                if (expr.kind === "int" || expr.kind === "float" || expr.kind === "string" || expr.kind === "var") {
                    return expr;
                }
                const temp = this.newTemp(scope);
                if (temp.kind !== "var") throw new LowerError("temporary is not a variable", node);
                prelude.push({ kind: "assign", target: temp, op: "=", value: expr });
                return temp;
            };
            container = evaluateOnce(container);
            key = evaluateOnce(key);

            const get = engineFunction("get_array", this.game);
            if (!get) throw new LowerError("engine function 'get_array' is unavailable", node);
            const binaryOp = op.slice(0, -1) as BinaryOp;
            if (!BINARY_OPS.has(binaryOp)) throw new LowerError(`unsupported compound assignment '${op}'`, node);
            const updated: Expr = {
                kind: "binary",
                op: binaryOp,
                left: { kind: "libCall", opcode: get.opcode, args: [container, key] },
                right: value(),
            };
            const store: Stmt = {
                kind: "libStmt",
                opcode: fn.opcode,
                args: [container, key, updated],
                ...popsResult,
            };
            return prelude.length > 0 ? { kind: "block", body: [...prelude, store] } : store;
        }
    }

    /** `call foo(...)` invokes a procedure and discards its result. */
    private lowerCallStatement(node: SyntaxNode, scope: Scope): Stmt | null {
        const target = node.childForFieldName("target");
        if (!target) throw new LowerError("call has no target", node);
        const delay = node.childForFieldName("delay");
        if (delay) {
            // The engine schedules the procedure instead of entering it, so a timed call takes no
            // arguments - `call foo(1) in 5` is a syntax the language accepts but cannot express.
            if (target.type === "call_expr") {
                this.report("a timed call cannot pass arguments", node);
                return null;
            }
            const callee = this.procedureRef(target, scope);
            if (callee.kind !== "procRef") {
                if (callee !== POISON) this.report(`unknown procedure '${target.text}'`, target);
                return null;
            }
            if (this.refusePureCallStatement(callee, target)) return null;
            return { kind: "timedCallStmt", target: callee, delay: this.lowerExpression(delay, scope) };
        }
        if (target.type === "call_expr") {
            const { callee, args, checkArgCount } = this.callParts(target, scope);
            if (this.refusePureCallStatement(callee, target)) return null;
            return { kind: "callStmt", target: callee, args, ...(checkArgCount ? { checkArgCount } : {}) };
        }
        const callee = this.procedureRef(target, scope);
        if (callee.kind !== "procRef") return { kind: "callStmt", target: callee, args: [], checkArgCount: true };
        if (this.refusePureCallStatement(callee, target)) return null;
        return { kind: "callStmt", target: callee, args: this.padWithDefaults(callee.index, []) };
    }

    /**
     * A bare expression statement is either an engine function used for its effect or a procedure call
     * whose result is discarded; the two compile differently, so the callee decides.
     */
    private lowerExpressionStatement(node: SyntaxNode, scope: Scope): Stmt | null {
        const increment = this.incrementOf(node, scope);
        if (increment) return increment;

        // A bare literal as a statement (`0;`) emits nothing: statement position only generates code
        // for recognised statement forms, and a lone value is not one. Real scripts use it as a no-op
        // to give a conditional branch an empty body.
        if (this.literalOf(node) !== null) return null;
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
            // Only an ENGINE function may be called as a bare statement. A procedure needs `call`, which
            // is a statement of its own - writing it bare is an error in the language, so accepting it
            // here would compile a script the compiler a user actually builds with refuses.
            const name = callee?.text ?? "it";
            this.report(`'${name}' is not an engine function; write 'call ${name}(...)'`, node);
            return null;
        }
        // An engine function that takes nothing is written without parentheses: `refresh_pc_art;`. It is
        // a call, not a bare value, and real scripts use the form constantly.
        if (node.type === "identifier") {
            const engine = engineFunction(node.text.toLowerCase(), this.game);
            if (engine && (engine.args ?? 0) === 0) {
                const statement: Stmt = { kind: "libStmt", opcode: engine.opcode, args: [] };
                return engine.popsResult ? { ...statement, popsResult: true } : statement;
            }
        }
        // Everything else in statement position has to assign. A bare variable or expression is not a
        // statement, and quietly emitting a fetch-and-discard for it hides a typo rather than reporting it.
        this.report("assignment operator expected", node);
        return null;
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
        const step: AssignOp = op === "++" ? "+=" : "-=";
        if (operand.type === "subscript_expr" || operand.type === "member_expr") {
            return this.elementAssignment(operand, step, () => ({ kind: "int", value: 1 }), scope);
        }
        const target = this.lowerExpression(operand, scope);
        // A reported statement still has to be one: `null` here means "not an increment at all", and the
        // two callers below would each go on to lower the operand a second time.
        if (target.kind !== "var") {
            if (target !== POISON) this.report("increment target must be a variable", operand);
            return POISON_STMT;
        }
        return { kind: "assign", target, op: step, value: { kind: "int", value: 1 } };
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
        return { callee, args: this.padWithDefaults(callee.index, args), checkArgCount: false };
    }

    /**
     * A call may omit trailing arguments whose parameters declare a default; the default is supplied
     * at the CALL SITE. `call foo;` with no parentheses is the same call and pads identically.
     */
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
            // A slot declared to take a procedure resolves procedures ahead of variables, the same
            // precedence `procedureRef` applies to a call target; a variable is used only where no
            // procedure carries the name.
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
     *
     * Procedures are looked up BEFORE locals, the opposite order to `reference` - a name in call
     * position means the procedure even when a local shadows it, which is what makes a procedure whose
     * parameter carries its own name still recurse rather than call its argument.
     */
    private procedureRef(node: SyntaxNode, scope: Scope): Expr {
        // `"name"(args)` calls the procedure the STRING names, which the engine resolves at run time.
        if (node.type === "string") return this.constantOf(node);
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
        if (this.reportedNames.has(key)) return POISON;
        this.reportedNames.add(key);
        return this.report(`unknown procedure '${node.text}'`, node);
    }

    /**
     * The process-control statements. `noop` is the one that emits nothing: it is a statement the
     * language accepts and the code generator drops, not an opcode.
     */
    private lowerProcessStatement(node: SyntaxNode, scope: Scope): Stmt | null {
        const op = node.childForFieldName("op")?.text.toLowerCase();
        if (!op) throw new LowerError("malformed process statement", node);
        if (op === "noop") return null;
        const opcode = PROCESS_OPCODES[op];
        if (opcode === undefined) throw new LowerError(`unsupported process statement '${op}'`, node);
        const argument = node.childForFieldName("arg");
        if (!argument) {
            // `cancelall` emits its opcode TWICE in the reference - the statement's own token is written
            // by the generic path and again by the case that handles it. Running it twice is harmless
            // (the second call finds no events left), and matching it keeps the output byte-identical.
            if (op === "cancelall") {
                return {
                    kind: "block",
                    body: [
                        { kind: "opStmt", opcode, args: [] },
                        { kind: "opStmt", opcode, args: [] },
                    ],
                };
            }
            return { kind: "opStmt", opcode, args: [] };
        }
        // `cancel` names a procedure; everything else takes a value.
        if (op === "cancel") {
            const index = this.procedures.get(argument.text.toLowerCase());
            if (index === undefined) {
                this.report(`unknown procedure '${argument.text}'`, argument);
                return null;
            }
            return { kind: "opStmt", opcode, args: [{ kind: "procRef", index }] };
        }
        return { kind: "opStmt", opcode, args: [this.lowerExpression(argument, scope)] };
    }

    /** Lowers a loop's body with the loop counted, so a `break` inside it resolves. */
    private inLoop<T>(lower: () => T): T {
        this.loopDepth++;
        try {
            return lower();
        } finally {
            this.loopDepth--;
        }
    }

    private requireLoop(node: SyntaxNode, what: string): void {
        if (this.loopDepth === 0) this.report(`'${what}' outside a loop`, node);
    }

    private lowerExpression(node: SyntaxNode, scope: Scope): Expr {
        switch (node.type) {
            case "number":
            case "string":
            case "char":
            case "boolean":
                return this.constantOf(node);

            case "paren_expr": {
                const inner = node.namedChildren.find((c) => c && c.type !== "comment");
                if (!inner) throw new LowerError("empty parentheses", node);
                return this.lowerExpression(inner, scope);
            }

            case "identifier":
                return this.reference(node, scope);

            // `@Name` passes the procedure by NAME, not by index: the engine resolves the string at
            // run time. The name therefore also occupies a slot in the string table.
            case "proc_ref": {
                const name = node.namedChildren[0];
                if (!name) throw new LowerError("malformed procedure reference", node);
                const index = this.procedures.get(name.text.toLowerCase());
                if (index === undefined) return this.report(`unknown procedure '${name.text}'`, name);
                return { kind: "procRef", index, stringify: true };
            }

            case "unary_expr": {
                const operand = node.childForFieldName("expr");
                const op = node.childForFieldName("op")?.text?.toLowerCase();
                if (!operand || !op) throw new LowerError("malformed unary expression", node);
                if (op === "-") return { kind: "unary", op: "negate", operand: this.lowerExpression(operand, scope) };
                if (op === "not" || op === "bwnot" || op === "floor") {
                    return { kind: "unary", op, operand: this.lowerExpression(operand, scope) };
                }
                // `++` and `--` reach here from EXPRESSION position (`a := b++`), where the language has
                // no such form - as a statement they were taken by `incrementOf` before this point.
                return this.report(`unsupported unary operator '${op}'`, node);
            }

            case "binary_expr": {
                const left = node.childForFieldName("left");
                const right = node.childForFieldName("right");
                const op = node.childForFieldName("op")?.text?.toLowerCase();
                if (!left || !right || !op) throw new LowerError("malformed binary expression", node);
                // The grammar carries one operator this does not: `in` tests array membership, which the
                // language's own parser has no production for either.
                if (!BINARY_OPS.has(op)) return this.report(`unsupported operator '${op}'`, node);
                // A comparison takes one comparison, not a chain: the language reads a single
                // `<expr> <op> <expr>` and stops, so `a == b == c` is a syntax error there. Parenthesise
                // to compare a comparison - `(a == b) == c` is a different tree and is accepted.
                if (COMPARISONS.has(op)) {
                    for (const side of [left, right]) {
                        const inner = side.childForFieldName("op")?.text?.toLowerCase();
                        if (side.type === "binary_expr" && inner && COMPARISONS.has(inner)) {
                            return this.report("comparisons do not chain; parenthesise one of them", node);
                        }
                    }
                }
                // Dividing by a literal zero is refused rather than emitted, the same way the language
                // refuses it: the engine has no defined result for it.
                if ((op === "/" || op === "%" || op === "div") && isZeroLiteral(right)) {
                    return this.report("division by zero", right);
                }
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
                        return libCall(engine.opcode, this.argumentsOf(node, scope, engine.procArgs));
                    }
                }
                const { callee, args, checkArgCount } = this.callParts(node, scope);
                return {
                    kind: "call",
                    target: callee,
                    args,
                    ...(checkArgCount ? { checkArgCount } : {}),
                    ...(this.callsPureProcedure(callee) ? { pure: true } : {}),
                };
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
        return libCall(fn.opcode, args);
    }

    /** Whether a lowered call target names a procedure declared `pure`. */
    private callsPureProcedure(callee: Expr): boolean {
        return callee.kind === "procRef" && this.pureProcedures.has(callee.index);
    }

    /**
     * A `pure` procedure is a function: it promises to have no side effects, which is what lets the
     * optimiser drop a call whose result nothing reads. `call` discards the result, so calling one that
     * way asks for exactly the effects it promised not to have - the language refuses it.
     */
    private refusePureCallStatement(callee: Expr, node: SyntaxNode): boolean {
        if (!this.callsPureProcedure(callee)) return false;
        this.report(`'${node.text}' is a pure procedure; use its value instead of 'call'`, node);
        return true;
    }

    /**
     * An `inline` procedure is pasted into its caller rather than called, so it has no value to yield and
     * cannot appear in an expression. Calling one as a statement is what the modifier is for.
     */
    private refuseInlineInExpression(index: number, node: SyntaxNode): Expr | null {
        if (!this.inlineProcedures.has(index)) return null;
        return this.report(`'${node.text}' is an inline procedure and has no value`, node);
    }

    /**
     * Resolves a bare identifier: locals shadow globals, which shadow shared variables, and a variable
     * of any scope shadows a procedure of the same name. `procedureRef` deliberately inverts that last
     * step, so `name(...)` calls the procedure while a bare `name` reads the variable.
     */
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
        if (engine) return libCall(engine.opcode, []);
        // A bare procedure name in expression position CALLS it with no arguments rather than yielding
        // its index - `@name` is the spelling that yields the index.
        const procedure = this.procedures.get(key);
        if (procedure !== undefined) {
            return (
                this.refuseInlineInExpression(procedure, node) ?? {
                    kind: "call",
                    target: { kind: "procRef", index: procedure },
                    args: [],
                    ...(this.pureProcedures.has(procedure) ? { pure: true } : {}),
                }
            );
        }
        // Reported once per name rather than once per use: a misspelling used thirty times is one
        // mistake, and thirty copies of it would bury every other error in the script.
        if (this.reportedNames.has(key)) return POISON;
        this.reportedNames.add(key);
        return this.report(`unknown identifier '${node.text}'`, node);
    }
}

/**
 * Whether a `#pragma sce` appears anywhere in the source.
 *
 * The preprocessor passes a pragma through untouched because it is the compiler's to read, and this is
 * where it gets read. Position does not matter: it turns the operators on for the whole program, not
 * from the line down.
 */
function hasShortCircuitPragma(root: SyntaxNode): boolean {
    const visit = (node: SyntaxNode): boolean => {
        if (node.type === "other_preprocessor" && /^#\s*pragma\s+sce\b/i.test(node.text)) return true;
        return node.namedChildren.some((child) => Boolean(child) && visit(child));
    };
    return visit(root);
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
        // `@Name` interns the procedure's name, though the source never quotes it.
        if (node.type === "proc_ref" && node.namedChildren[0]) out.push(node.namedChildren[0].text);
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

/**
 * The reference compiler's escape table. `\v` yields a TAB there, not a vertical tab, and anything not
 * listed keeps its own character - both are that compiler's behaviour, so both are reproduced here.
 */
const ESCAPES: Record<string, string> = {
    a: "\u0007",
    b: "\b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "\t",
    v: "\t",
};

/** Decodes one string literal, or several written adjacently - the grammar hands those over as one node. */
function unquote(text: string): string {
    let out = "";
    for (const [segment] of text.matchAll(/"([^"\\]|\\.)*"/g)) {
        out += segment.slice(1, -1).replaceAll(/\\(.)/g, (_, char: string) => ESCAPES[char] ?? char);
    }
    return out;
}

/**
 * A character constant's integer value, or `null` for an escape outside the table - narrower than a
 * string's, where an unlisted escape keeps its own character. The octal form is accepted here and
 * nowhere else. The caller reports, since it holds the diagnostic sink.
 */
function charConstant(node: SyntaxNode): number | null {
    const body = node.text.slice(1, -1);
    if (!body.startsWith("\\")) return body.codePointAt(0) ?? 0;
    // `\0` then two or three octal digits. The leading zero is a marker rather than a digit, but it does
    // not change the value either way, so the whole run is parsed base 8.
    const octal = /^\\0[0-7]{2,3}$/.exec(body);
    if (octal) return Number.parseInt(body.slice(1), 8);
    const escaped = ESCAPES[body.slice(1)];
    if (escaped === undefined) return null;
    return escaped.codePointAt(0) ?? 0;
}

/** Lowers a parsed SSL tree to the emitter's IR. */
export function lowerProgram(tree: Tree, options: LowerOptions = {}): Program {
    return new Lowering(options).lower(tree.rootNode);
}
