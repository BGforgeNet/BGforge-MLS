/**
 * Reconstructs the IR from compiled INT bytecode - the inverse of the emitter.
 *
 * Targeting the IR rather than source text is what makes this verifiable: re-emitting the result must
 * reproduce the input byte for byte, so the emitter is the decompiler's oracle and no parser or printer
 * sits in between to absorb a mistake. Rendering that IR as source is a separate step in `print.ts`.
 *
 * The method is a stack machine rather than a control-flow analysis. Every expression the emitter
 * produces is stack-balanced and yields exactly one value, and every statement yields none, so walking
 * the instruction stream while maintaining a stack of pending values recovers the expression tree
 * directly. Control flow is recovered from the shapes the emitter writes: a jump target is always a
 * constant pushed ahead of the test that consumes it, which makes an `if` and a `while` recognisable at
 * the instruction that closes them rather than by reasoning about a graph.
 *
 * WHAT IS NOT IN THE FILE. Local and argument names are never written to an INT, so they come back as
 * generated names; `define` constants, macros and comments are resolved away by the preprocessor long
 * before codegen. What the bytes do determine - structure, operators, literals, and every global,
 * external and procedure name - comes back exactly.
 */

import { O_FLOATOP, O_INTOP, O_STRINGOP, OPCODE_SIZE, Op } from "./opcodes";
import { engineFunctionAt } from "./engine-functions";
import { EngineOp } from "./opcodes-engine";
import { decodeRange, isPush, toFloat, type Instruction } from "./disasm";
import { readInt, toSigned, type IntFile, type IntProcedureEntry } from "./read";
import { PLACEHOLDER_NAME } from "./emit";
import type { BinaryOp, Declaration, Expr, ProcedureDecl, Program, Stmt, UnaryOp, VariableDecl } from "./ir";

/** Bytes a constant push occupies, needed to step over one when checking for a pattern by address. */
const PUSH_SIZE = OPCODE_SIZE + 4;

/** Together these close a branch or a loop: `push.int <target>` then `JMP`. */
const JUMP_SIZE = PUSH_SIZE + OPCODE_SIZE;

export class DecompileError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DecompileError";
    }
}

const BINARY_BY_OPCODE = new Map<number, BinaryOp>([
    [Op.ADD, "+"],
    [Op.SUB, "-"],
    [Op.MUL, "*"],
    [Op.DIV, "/"],
    [Op.MOD, "%"],
    [Op.EQUAL, "=="],
    [Op.NOT_EQUAL, "!="],
    [Op.LESS_EQUAL, "<="],
    [Op.GREATER_EQUAL, ">="],
    [Op.LESS, "<"],
    [Op.GREATER, ">"],
    [Op.AND, "and"],
    [Op.OR, "or"],
    [Op.BWAND, "bwand"],
    [Op.BWOR, "bwor"],
    [Op.BWXOR, "bwxor"],
    // Integer division and exponentiation are engine additions rather than core instructions, but they
    // are spelled as operators in source and must be recovered as such, not as function calls.
    [EngineOp.TS_DIV, "div"],
    [EngineOp.TS_POW, "^"],
]);

const UNARY_BY_OPCODE = new Map<number, UnaryOp>([
    [Op.NOT, "not"],
    [Op.BWNOT, "bwnot"],
    [Op.NEGATE, "negate"],
    [Op.FLOOR, "floor"],
]);

/**
 * A pending stack entry.
 *
 * Constant pushes stay raw until something consumes them, because a longword's meaning is decided by
 * its consumer: the same `push.int` is an integer literal to an operator, a code address to a jump, a
 * procedure slot to a call, and the same `push.str` is a string-space offset to an operator but a
 * NAMELIST offset to the external-variable instructions.
 */
type Value =
    | { kind: "const"; push: "int" | "float" | "str"; raw: number; address: number }
    | { kind: "expr"; expr: Expr }
    /**
     * A branch whose arms both ended in a value, which the emitter writes identically whether it is a
     * conditional expression or an `if`/`else` whose arms each end in an unused engine result. Both
     * readings are carried until something settles it: if the value is consumed it was the expression,
     * and if it is still pending when a statement completes it was the branch.
     */
    | { kind: "branch"; expr: Expr; statement: Stmt };

interface LoopFrame {
    /** Where the condition test begins, which is where a plain `continue` jumps. */
    conditionStart: number;
    /**
     * Where a `continue` in a counted loop jumps: past the body, before the step that advances it.
     * A `for` or `foreach` sends its continues here rather than to the condition so the step still
     * runs, and the IR marks the spot so re-emitting patches them to the same address.
     */
    continueTarget: number | null;
    marked: boolean;
}

interface Context {
    procedure: ProcedureDecl;
    loops: LoopFrame[];
}

class Decompiler {
    private readonly file: IntFile;
    private readonly code: Instruction[];
    private readonly indexAt = new Map<number, number>();
    /** Namelist offsets that name an external variable rather than a global. */
    private readonly externalOffsets = new Set<number>();
    /** Imported variables the code never touches, identified only by the globals section's count. */
    private readonly hiddenImports = new Set<string>();
    private readonly procedureBySlot: IntProcedureEntry[];
    /** Slot index per global, assigned in declaration order. */
    private readonly globalSlots = new Map<string, number>();
    private readonly globalNames: string[] = [];
    private readonly globals = new Map<string, VariableDecl>();
    private readonly externals = new Map<string, VariableDecl>();
    private exportedProcedureSlots = new Set<number>();
    /** Set by the `DUP; push; CHECK_ARG_COUNT` prefix, consumed by the CALL it guards. */
    private pendingArgCountCheck = false;
    private stack: Value[] = [];
    private at = 0;

    constructor(file: IntFile) {
        this.file = file;
        this.code = decodeRange(file.bytes, file.globalsOffset, file.bytes.length);
        this.code.forEach((instruction, index) => this.indexAt.set(instruction.address, index));
        this.procedureBySlot = file.procedures;
        this.findExternals();
    }

    // -- Names --

    /**
     * An external is reached by name, so the instructions that do so identify one. A non-exported
     * external appears nowhere else - the globals section skips it entirely - which is why this scans
     * the whole code region rather than only that section.
     */
    private findExternals(): void {
        for (let i = 1; i < this.code.length; i++) {
            const instruction = this.code[i]!;
            const namesAnExternal =
                instruction.opcode === Op.FETCH_EXTERNAL ||
                instruction.opcode === Op.STORE_EXTERNAL ||
                instruction.opcode === Op.EXPORT_VAR;
            if (!namesAnExternal) continue;
            const previous = this.code[i - 1]!;
            if (previous.opcode === O_STRINGOP) this.externalOffsets.add(previous.operand!);
        }
    }

    /**
     * The namelist is written in source declaration order, so walking it in offset order recovers that
     * order. Entries naming a procedure are known from the procedure table and entries naming an
     * external from the scan above; whatever is left is a global, and their positions in this walk are
     * their slot indices.
     *
     * An imported variable that the script never reads and never exports emits no code whatsoever, so
     * nothing distinguishes its namelist entry from a global's. The globals section says how many
     * globals there are, which is how many such entries are hiding among them; the ones nearest a
     * known external are taken to be the imports, since a declaration block tends to hold several.
     * The choice cannot change the output - the namelist keeps declaration order whatever the kind,
     * and initialisers are written in that same order - so only the label on the recovered
     * declaration is at stake.
     */
    private classifyNames(globalCount: number): void {
        const procedureNameOffsets = new Set(this.file.procedures.map((procedure) => procedure.nameOffset));
        const ordered = [...this.file.names].sort((a, b) => a[0] - b[0]);
        const externalPositions = ordered.flatMap(([offset], index) =>
            this.externalOffsets.has(offset) ? [index] : [],
        );
        const candidates = ordered.flatMap(([offset, name], index) =>
            procedureNameOffsets.has(offset) || this.externalOffsets.has(offset) ? [] : [{ name, index }],
        );

        const hidden = candidates.length - globalCount;
        if (hidden < 0) {
            throw new DecompileError(
                `globals section initialises ${globalCount} slots but only ${candidates.length} names are available`,
            );
        }
        const distance = (index: number) =>
            externalPositions.reduce((best, at) => Math.min(best, Math.abs(at - index)), Number.MAX_SAFE_INTEGER);
        const imports = new Set(
            [...candidates]
                .sort((a, b) => distance(a.index) - distance(b.index) || a.index - b.index)
                .slice(0, hidden)
                .map((candidate) => candidate.name),
        );

        for (const candidate of candidates) {
            if (imports.has(candidate.name)) {
                this.hiddenImports.add(candidate.name);
                continue;
            }
            this.globalSlots.set(candidate.name, this.globalNames.length);
            this.globalNames.push(candidate.name);
        }
    }

    private nameAt(offset: number): string {
        const name = this.file.names.get(offset);
        if (name === undefined) throw new DecompileError(`namelist offset ${offset} is not a record`);
        return name;
    }

    private stringAt(offset: number): string {
        const text = this.file.strings.get(offset);
        if (text === undefined) throw new DecompileError(`string offset ${offset} is not a record`);
        return text;
    }

    // -- Stack helpers --

    private pop(what: string): Value {
        const value = this.stack.pop();
        if (value === undefined) throw new DecompileError(`stack underflow reading ${what}`);
        return value;
    }

    private popExpr(what: string): Expr {
        return this.toExpr(this.pop(what));
    }

    private toExpr(value: Value): Expr {
        if (value.kind === "expr" || value.kind === "branch") return value.expr;
        switch (value.push) {
            case "int":
                return { kind: "int", value: toSigned(value.raw) };
            case "float":
                return { kind: "float", value: toFloat(value.raw) };
            default:
                return { kind: "string", value: this.stringAt(value.raw) };
        }
    }

    /** A raw operand the consumer needs unresolved - an address, a slot index, a namelist offset. */
    private popRaw(what: string): { raw: number; address: number } {
        const value = this.pop(what);
        if (value.kind !== "const") throw new DecompileError(`expected a constant for ${what}`);
        return { raw: value.raw, address: value.address };
    }

    // -- Program --

    decompile(): Program {
        this.parseGlobalsSection();
        const bodies = this.parseProcedures();

        const declarations: Declaration[] = [];
        const procedureNameOffsets = new Map<number, IntProcedureEntry>();
        for (const procedure of this.file.procedures) procedureNameOffsets.set(procedure.nameOffset, procedure);

        for (const [offset, name] of [...this.file.names].sort((a, b) => a[0] - b[0])) {
            if (name === PLACEHOLDER_NAME) continue;
            const entry = procedureNameOffsets.get(offset);
            if (entry !== undefined) {
                const body = bodies.get(entry);
                if (body !== undefined) declarations.push({ kind: "procedure", procedure: body });
                continue;
            }
            if (this.externalOffsets.has(offset) || this.hiddenImports.has(name)) {
                declarations.push({ kind: "external", variable: this.externals.get(name) ?? blankVariable(name) });
                continue;
            }
            declarations.push({ kind: "global", variable: this.globals.get(name) ?? blankVariable(name) });
        }

        return { declarations, stringLiterals: this.stringOrder() };
    }

    /**
     * The globals section initialises every global, exports what is exported, and jumps to `start`.
     *
     * Global initialisers are pushed and simply left on the stack - a global's slot IS its stack slot -
     * so whatever remains once the export instructions have taken their operands is the list of
     * initialisers, in declaration order.
     */
    private parseGlobalsSection(): void {
        this.at = 0;
        const first = this.code[0];
        if (first === undefined || first.opcode !== Op.SET_GLOBAL) {
            throw new DecompileError("globals section does not begin with SET_GLOBAL");
        }
        this.at = 1;

        const exportedProcedures = new Set<number>();
        const exportedExternals = new Set<string>();
        const externalInitial = new Map<string, Expr>();

        for (;;) {
            const instruction = this.code[this.at];
            if (instruction === undefined) throw new DecompileError("globals section runs off the end of the file");
            this.at++;

            if (isPush(instruction.opcode)) {
                this.stack.push(constValue(instruction));
                continue;
            }
            if (instruction.opcode === Op.EXPORT_VAR) {
                exportedExternals.add(this.nameAt(this.popRaw("exported variable name").raw));
                continue;
            }
            if (instruction.opcode === Op.STORE_EXTERNAL) {
                const name = this.nameAt(this.popRaw("external variable name").raw);
                externalInitial.set(name, this.popExpr("external initial value"));
                continue;
            }
            if (instruction.opcode === Op.EXPORT_PROC) {
                const slot = this.popRaw("exported procedure slot").raw;
                this.popRaw("exported procedure argument count");
                exportedProcedures.add(slot);
                continue;
            }
            if (instruction.opcode === Op.CRITICAL_DONE) {
                // The zero pushed ahead of it is the starting procedure's argument count.
                this.popRaw("starting procedure argument count");
                break;
            }
            throw new DecompileError(`unexpected ${instruction.opcode} in the globals section`);
        }

        // The section ends by jumping to `start`. The target is read past rather than recorded: the
        // procedure table already says where every procedure begins.
        this.expect(O_INTOP, "entry jump target");
        this.expect(Op.JMP, "entry jump");

        const initialisers = this.stack;
        this.stack = [];
        this.classifyNames(initialisers.length);
        this.globalNames.forEach((name, index) => {
            this.globals.set(name, {
                name,
                initial: asInitial(this.toExpr(initialisers[index]!), name),
            });
        });
        for (const [name, initial] of externalInitial) {
            this.externals.set(name, { name, initial: asInitial(initial, name), exported: true });
        }
        for (const name of exportedExternals) {
            if (!this.externals.has(name)) {
                this.externals.set(name, { name, initial: { kind: "int", value: 0 }, exported: true });
            }
        }
        this.exportedProcedureSlots = exportedProcedures;
    }

    /** Each procedure's body occupies the span from its own code offset to the next one's. */
    private parseProcedures(): Map<IntProcedureEntry, ProcedureDecl> {
        const bodies = new Map<IntProcedureEntry, ProcedureDecl>();
        const withCode = this.file.procedures
            .map((procedure, slot) => ({ procedure, slot }))
            .filter(({ procedure }) => !procedure.imported && procedure.name !== PLACEHOLDER_NAME);
        const boundaries = [...withCode].sort((a, b) => a.procedure.codeOffset - b.procedure.codeOffset);

        boundaries.forEach(({ procedure, slot }, position) => {
            const end = boundaries[position + 1]?.procedure.codeOffset ?? this.file.bytes.length;
            try {
                bodies.set(procedure, this.parseProcedure(procedure, slot, end));
            } catch (error) {
                // Naming the procedure turns a bare stack complaint into something locatable, both for
                // a user reading a failed decompile and for the corpus differential's error grouping.
                throw new DecompileError(`in procedure '${procedure.name}': ${(error as Error).message}`);
            }
        });

        for (const procedure of this.file.procedures) {
            if (!procedure.imported || procedure.name === PLACEHOLDER_NAME) continue;
            bodies.set(procedure, {
                name: procedure.name,
                args: argumentNames(procedure.argCount),
                locals: [],
                body: [],
                imported: true,
            });
        }
        return bodies;
    }

    private parseProcedure(entry: IntProcedureEntry, slot: number, end: number): ProcedureDecl {
        const declaration: ProcedureDecl = {
            name: entry.name,
            args: argumentNames(entry.argCount),
            locals: [],
            body: [],
        };
        if (entry.exported || this.exportedProcedureSlots.has(slot)) declaration.exported = true;
        if (entry.critical) declaration.critical = true;
        if (entry.pure) declaration.pure = true;
        if (entry.inline) declaration.inline = true;
        if (entry.timed) declaration.timed = entry.time;

        this.stack = [];
        this.seek(entry.codeOffset);

        if (entry.conditional) {
            // A guard is written as a jump over it, then the guard itself, then the body.
            this.expect(O_INTOP, "conditional procedure body address");
            const bodyAddress = this.code[this.at - 1]!.operand!;
            this.expect(Op.JMP, "jump past a procedure guard");
            this.expect(Op.CRITICAL_START, "start of a procedure guard");
            this.parseUntil(bodyAddress - 2 * OPCODE_SIZE, { procedure: declaration, loops: [] });
            declaration.conditional = this.popExpr("procedure guard");
            this.expect(Op.CRITICAL_DONE, "end of a procedure guard");
            this.expect(Op.STOP_PROG, "end of a procedure guard");
        }

        this.expect(Op.PUSH_BASE, `start of procedure '${entry.name}'`);
        // Every procedure ends with the implicit return, so the flush that precedes each statement has
        // already run at the last possible point; anything still pending here is a real inconsistency
        // and is reported by the locals split below rather than appended after a return.
        const context: Context = { procedure: declaration, loops: [] };
        declaration.body = stripImplicitReturn(this.parseUntil(end, context));

        // Whatever is still pending once the body is parsed was never consumed, and an unconsumed push
        // in a procedure prologue is a local variable's slot.
        declaration.locals = this.stack.map((value, index) => ({
            name: localName(entry.argCount + index),
            initial: asInitial(this.toExpr(value), `local ${index}`),
        }));
        this.stack = [];
        return declaration;
    }

    // -- Cursor --

    private seek(address: number): void {
        const index = this.indexAt.get(address);
        if (index === undefined) throw new DecompileError(`address ${address} is not an instruction boundary`);
        this.at = index;
    }

    private expect(opcode: number, what: string): void {
        const instruction = this.code[this.at];
        if (instruction === undefined || instruction.opcode !== opcode) {
            throw new DecompileError(`expected ${what} at ${instruction?.address ?? "end of file"}`);
        }
        this.at++;
    }

    private opcodeAt(address: number): number | undefined {
        const index = this.indexAt.get(address);
        return index === undefined ? undefined : this.code[index]!.opcode;
    }

    // -- Statements --

    private parseUntil(end: number, context: Context): Stmt[] {
        const statements: Stmt[] = [];
        // Values already pending belong to whatever encloses this region - a call whose result is still
        // being assembled around an `if`, say - so the flush below must not reach past them.
        const floor = this.stack.length;
        for (;;) {
            const instruction = this.code[this.at];
            if (instruction === undefined || instruction.address >= end) return statements;
            const frame = context.loops[context.loops.length - 1];
            if (frame !== undefined && !frame.marked && frame.continueTarget === instruction.address) {
                frame.marked = true;
                statements.push({ kind: "loopEnd" });
            }
            const produced = this.step(instruction, context, end);
            if (produced) statements.push(...this.flushUnusedResults(floor), ...produced);
        }
    }

    /**
     * Engine calls whose result nothing consumed, recovered as statements.
     *
     * Whether an opcode leaves a value is a property of the engine that the signature data only
     * approximates, and the two disagree: the reference emits no discard after `use_obj_on_obj` in
     * statement position even though it is documented as returning one. Rather than trust either side,
     * this reads what the code does - a value still pending when a statement completes was never an
     * operand, so the call that produced it was a statement. Locals cannot be caught by this: their
     * initialisers are constants, and the scan stops at the first value that is not an engine call.
     */
    private flushUnusedResults(floor: number): Stmt[] {
        const statements: Stmt[] = [];
        while (this.stack.length > floor) {
            const top = this.stack[this.stack.length - 1];
            if (top === undefined) return statements;
            if (top.kind === "branch") {
                this.stack.pop();
                statements.unshift(top.statement);
                continue;
            }
            if (top.kind !== "expr" || top.expr.kind !== "libCall") return statements;
            this.stack.pop();
            statements.unshift({ kind: "libStmt", opcode: top.expr.opcode, args: top.expr.args });
        }
        return statements;
    }

    /**
     * Advances past one instruction, returning any statements it completes.
     *
     * Most instructions only move values on and off the stack; a statement is recognised at the point
     * something makes its result unreachable - a store, a discard, a return - or at a structural
     * opcode that opens a branch or a loop.
     */
    private step(instruction: Instruction, context: Context, regionEnd: number): Stmt[] | null {
        this.at++;
        const opcode = instruction.opcode;

        if (isPush(opcode)) {
            this.stack.push(constValue(instruction));
            return null;
        }

        const binary = BINARY_BY_OPCODE.get(opcode);
        if (binary !== undefined) {
            const right = this.popExpr(`right operand of '${binary}'`);
            const left = this.popExpr(`left operand of '${binary}'`);
            this.stack.push({ kind: "expr", expr: { kind: "binary", op: binary, left, right } });
            return null;
        }

        const unary = UNARY_BY_OPCODE.get(opcode);
        if (unary !== undefined) {
            this.stack.push({ kind: "expr", expr: { kind: "unary", op: unary, operand: this.popExpr(unary) } });
            return null;
        }

        switch (opcode) {
            case Op.FETCH:
                return this.fetch("local", context);
            case Op.FETCH_GLOBAL:
                return this.fetch("global", context);
            case Op.FETCH_EXTERNAL:
                return this.fetch("external", context);

            case Op.STORE:
                return [this.store("local", context)];
            case Op.STORE_GLOBAL:
                return [this.store("global", context)];
            case Op.STORE_EXTERNAL:
                return [this.store("external", context)];

            case Op.IF:
                return this.branch(context, regionEnd);
            case Op.WHILE:
                return this.loop(context);
            case Op.JMP:
                return this.jump(instruction, context);

            case Op.DUP:
                return this.duplicate(context);
            case Op.CALL:
                return this.call();
            case Op.LOOKUP_STRING_PROC:
                // The value stays as it is; the emitter re-derives this instruction from the target's kind.
                return null;

            case Op.POP:
                return [this.discard()];

            case Op.D_TO_A:
                return this.returnOrCallMarker(context);
            case Op.POP_TO_BASE:
                return [this.bareReturn(context)];

            case Op.NOOP:
                return null;

            default:
                return this.engineCall(instruction);
        }
    }

    private fetch(scope: "local" | "global" | "external", context: Context): null {
        if (scope === "external") {
            const name = this.nameAt(this.popRaw("external variable name").raw);
            this.stack.push({ kind: "expr", expr: { kind: "var", scope, index: 0, name } });
            return null;
        }
        const index = this.popRaw(`${scope} variable slot`).raw;
        this.stack.push({
            kind: "expr",
            expr: { kind: "var", scope, index, name: this.variableName(scope, index, context) },
        });
        return null;
    }

    private store(scope: "local" | "global" | "external", context: Context): Stmt {
        const target: Extract<Expr, { kind: "var" }> =
            scope === "external"
                ? { kind: "var", scope, index: 0, name: this.nameAt(this.popRaw("external variable name").raw) }
                : (() => {
                      const index = this.popRaw(`${scope} variable slot`).raw;
                      return { kind: "var" as const, scope, index, name: this.variableName(scope, index, context) };
                  })();
        return { kind: "assign", target, op: "=", value: this.popExpr("assigned value") };
    }

    private variableName(scope: "local" | "global", index: number, context: Context): string {
        if (scope === "global") return this.globalNames[index] ?? `global_${index}`;
        return index < context.procedure.args.length ? context.procedure.args[index]! : localName(index);
    }

    /**
     * An `if` and a conditional expression are the same instructions; what separates them is whether
     * the branches leave a value behind. A branch that produced no statements and grew the stack by one
     * is a value, so the pair is the language's `x if c else y` rather than a statement.
     */
    private branch(context: Context, regionEnd: number): Stmt[] | null {
        const condition = this.popExpr("branch condition");
        const falseAddress = this.popRaw("branch target").raw;
        const depth = this.stack.length;

        // An else-branch cannot outlive the region holding it. Rejecting a target past the end is
        // what stops a `continue` deep in a nest from being read as an else that swallows the
        // statements following its enclosing `if`.
        let elseAddress = this.elseJumpBefore(falseAddress);
        if (elseAddress !== null && elseAddress > regionEnd) elseAddress = null;
        let thenBranch: Stmt[];

        if (elseAddress === null) {
            thenBranch = this.parseUntil(falseAddress, context);
        } else {
            // The `push; JMP` before the target may not be this branch's else-jump at all: a `continue`
            // or `break` ending the then-branch writes the same two instructions in the same place. The
            // readings differ in where the then-branch stops, so try the else and check - if the parse
            // ran past where an else-jump would begin, the jump belonged to the then-branch after all.
            const mark = this.snapshot(context);
            let overran: boolean;
            try {
                thenBranch = this.parseUntil(falseAddress - JUMP_SIZE, context);
                overran = this.code[this.at]?.address !== falseAddress - JUMP_SIZE;
            } catch (error) {
                // A region cut short at the wrong place fails rather than merely overrunning, which is
                // the same evidence against the hypothesis. If the reading without an else is also
                // wrong, its own failure is the one that surfaces.
                if (!(error instanceof DecompileError)) throw error;
                overran = true;
                thenBranch = [];
            }
            if (overran) {
                this.restore(mark);
                elseAddress = null;
                thenBranch = this.parseUntil(falseAddress, context);
            }
        }

        // An `if` with no `else` cannot be the conditional expression, so a pending value here is an
        // unused engine result rather than the branch's value.
        if (elseAddress === null) {
            thenBranch.push(...this.flushUnusedResults(depth));
            this.requireDepth(depth, "an if without an else");
            return [{ kind: "if", cond: condition, thenBranch: blockOf(thenBranch) }];
        }

        const thenIsValue = thenBranch.length === 0 && this.stack.length === depth + 1;
        this.seek(falseAddress);
        const whenTrue = thenIsValue ? this.pop("conditional true value") : null;
        if (!thenIsValue) thenBranch.push(...this.flushUnusedResults(depth));

        const elseBranch = this.parseUntil(elseAddress, context);
        const elseIsValue = elseBranch.length === 0 && this.stack.length === depth + 1;
        const whenFalse = elseIsValue ? this.pop("conditional false value") : null;
        if (!elseIsValue) elseBranch.push(...this.flushUnusedResults(depth));

        // One arm yielding a value and the other not means that value was an unused engine result, not
        // a branch value: put it back so the flush turns it into the statement it always was.
        if (thenIsValue !== elseIsValue) {
            if (whenTrue !== null) {
                this.stack.push(whenTrue);
                thenBranch.push(...this.flushUnusedResults(depth));
            }
            if (whenFalse !== null) {
                this.stack.push(whenFalse);
                elseBranch.push(...this.flushUnusedResults(depth));
            }
        }

        const statement: Stmt = {
            kind: "if",
            cond: condition,
            thenBranch: blockOf(thenBranch),
            elseBranch: blockOf(elseBranch),
        };
        if (thenIsValue && elseIsValue) {
            this.stack.push(this.branchValue(condition, whenTrue!, whenFalse!, thenBranch, elseBranch));
            return null;
        }
        this.requireDepth(depth, "an if/else");
        return [statement];
    }

    /** Both readings of a value-yielding branch, for the deferral described on the `branch` value. */
    private branchValue(condition: Expr, whenTrue: Value, whenFalse: Value, before: Stmt[], after: Stmt[]): Value {
        const expr: Expr = {
            kind: "ternary",
            cond: condition,
            whenTrue: this.toExpr(whenTrue),
            whenFalse: this.toExpr(whenFalse),
        };
        const thenStatement = asStatement(whenTrue);
        const elseStatement = asStatement(whenFalse);
        if (thenStatement === null || elseStatement === null) return { kind: "expr", expr };
        return {
            kind: "branch",
            expr,
            statement: {
                kind: "if",
                cond: condition,
                thenBranch: blockOf([...before, thenStatement]),
                elseBranch: blockOf([...after, elseStatement]),
            },
        };
    }

    /**
     * Enough state to re-run a region under a different reading. Loop frames are restored field by
     * field rather than replaced, because the loop currently being parsed holds a reference to its own
     * frame and swapping in a copy would leave it updating an object nobody reads.
     */
    private snapshot(context: Context) {
        return {
            at: this.at,
            stack: [...this.stack],
            pendingArgCountCheck: this.pendingArgCountCheck,
            loops: context.loops.map((frame) => ({ frame, ...frame })),
        };
    }

    private restore(mark: ReturnType<Decompiler["snapshot"]>): void {
        this.at = mark.at;
        this.stack = mark.stack;
        this.pendingArgCountCheck = mark.pendingArgCountCheck;
        for (const saved of mark.loops) {
            saved.frame.continueTarget = saved.continueTarget;
            saved.frame.marked = saved.marked;
        }
    }

    /** The `push <address>; JMP` that closes a then-branch, if one sits immediately before the target. */
    private elseJumpBefore(falseAddress: number): number | null {
        if (this.opcodeAt(falseAddress - OPCODE_SIZE) !== Op.JMP) return null;
        const pushAddress = falseAddress - JUMP_SIZE;
        if (this.opcodeAt(pushAddress) !== O_INTOP) return null;
        const target = this.code[this.indexAt.get(pushAddress)!]!.operand!;
        // An empty `else` puts the merge point exactly at the false target, so the two coincide. A
        // backwards target is a loop's back edge instead, and belongs to the then-branch.
        return target >= falseAddress ? target : null;
    }

    private loop(context: Context): Stmt[] {
        const condition = this.popExpr("loop condition");
        const exit = this.popRaw("loop exit target");
        const top = exit.address + PUSH_SIZE;
        const backEdge = exit.raw - JUMP_SIZE;

        const depth = this.stack.length;
        const frame: LoopFrame = { conditionStart: top, continueTarget: null, marked: false };
        context.loops.push(frame);
        const body = this.parseUntil(backEdge, context);
        body.push(...this.flushUnusedResults(depth));
        context.loops.pop();
        this.requireDepth(depth, "a loop body");

        this.seek(backEdge);
        this.expect(O_INTOP, "loop back edge");
        this.expect(Op.JMP, "loop back edge");
        return [{ kind: "while", cond: condition, body: blockOf(body) }];
    }

    /**
     * A jump is a `break` when nothing was pushed for it - the loop's exit address is already on the
     * VM's stack and a bare jump consumes it. A jump that does carry a target is a `continue`, and the
     * target says which kind of loop it belongs to: the condition for a plain loop, or the point before
     * a counted loop's increment.
     */
    private jump(instruction: Instruction, context: Context): Stmt[] {
        const frame = context.loops[context.loops.length - 1];
        const previous = this.code[this.at - 2];
        const carriesTarget =
            previous !== undefined &&
            previous.opcode === O_INTOP &&
            previous.address + PUSH_SIZE === instruction.address &&
            this.stack.length > 0 &&
            this.stack[this.stack.length - 1]!.kind === "const" &&
            (this.stack[this.stack.length - 1] as { address: number }).address === previous.address;

        if (!carriesTarget) return [{ kind: "break" }];

        const target = this.popRaw("jump target").raw;
        if (frame === undefined) throw new DecompileError(`jump to ${target} outside a loop`);
        if (target !== frame.conditionStart) frame.continueTarget = target;
        return [{ kind: "continue" }];
    }

    /**
     * Two constructs duplicate the top of the stack: the argument-count guard on an indirect call, and
     * a short-circuiting `andalso`/`orelse`, which keeps a copy of the left operand so that the copy
     * becomes the result when the left already decides the outcome.
     */
    private duplicate(context: Context): null {
        if (this.stack.length === 0) throw new DecompileError("DUP on an empty stack");
        if (this.code[this.at]?.opcode === O_INTOP && this.code[this.at + 1]?.opcode === Op.CHECK_ARG_COUNT) {
            this.at += 2;
            this.pendingArgCountCheck = true;
            return null;
        }
        return this.shortCircuit(context);
    }

    private shortCircuit(context: Context): null {
        const skipPush = this.code[this.at];
        if (skipPush?.opcode !== O_INTOP || this.code[this.at + 1]?.opcode !== Op.SWAP) {
            throw new DecompileError("DUP is neither an argument-count check nor a short-circuit operator");
        }
        // The `or` form negates the duplicated operand before the test, which is what tells the two apart.
        let cursor = this.at + 2;
        const isOr = this.code[cursor]?.opcode === Op.NOT;
        if (isOr) cursor++;
        if (this.code[cursor]?.opcode !== Op.IF || this.code[cursor + 1]?.opcode !== Op.POP) {
            throw new DecompileError("malformed short-circuit operator");
        }
        this.at = cursor + 2;

        const left = this.popExpr("left operand of a short-circuit operator");
        const depth = this.stack.length;
        const statements = this.parseUntil(skipPush.operand!, context);
        if (statements.length > 0) throw new DecompileError("a short-circuit operand produced statements");
        this.requireDepth(depth + 1, "a short-circuit operand");
        const right = this.popExpr("right operand of a short-circuit operator");
        this.stack.push({ kind: "expr", expr: { kind: "binary", op: isOr ? "orelse" : "andalso", left, right } });
        return null;
    }

    private call(): null {
        const target = this.pop("call target");
        const count = this.popRaw("call argument count").raw;
        const args: Expr[] = [];
        for (let i = 0; i < count; i++) args.unshift(this.popExpr("call argument"));
        this.popRaw("call return address");

        const callee: Expr =
            target.kind === "const" && target.push === "int"
                ? { kind: "procRef", index: target.raw - 1 }
                : this.toExpr(target);
        const expression: Expr = { kind: "call", target: callee, args };
        if (this.pendingArgCountCheck) {
            expression.checkArgCount = true;
            this.pendingArgCountCheck = false;
        }
        this.stack.push({ kind: "expr", expr: expression });
        return null;
    }

    /** A discarded value is a call written as a statement. */
    private discard(): Stmt {
        const value = this.popExpr("discarded value");
        if (value.kind === "call") {
            return { kind: "callStmt", target: value.target, args: value.args, checkArgCount: value.checkArgCount };
        }
        if (value.kind === "libCall") {
            return { kind: "libStmt", opcode: value.opcode, args: value.args, popsResult: true };
        }
        return { kind: "expr", expr: value };
    }

    /**
     * `D_TO_A` opens a return when `SWAPA` follows it, and otherwise marks the return address a call
     * pushed a moment earlier - the same instruction in two roles, told apart by what comes next.
     */
    private returnOrCallMarker(context: Context): Stmt[] | null {
        if (this.code[this.at]?.opcode !== Op.SWAPA) return null;
        this.at++;
        const value = this.popExpr("returned value");
        this.expect(Op.POP_TO_BASE, "return epilogue");
        this.expect(Op.POP_BASE, "return epilogue");
        this.expect(Op.A_TO_D, "return epilogue");
        if (context.procedure.critical) this.expect(Op.CRITICAL_DONE, "critical return epilogue");
        this.expect(Op.POP_RETURN, "return epilogue");
        return [{ kind: "return", value }];
    }

    private bareReturn(context: Context): Stmt {
        this.expect(Op.POP_BASE, "return epilogue");
        if (context.procedure.critical) this.expect(Op.CRITICAL_DONE, "critical return epilogue");
        this.expect(Op.POP_RETURN, "return epilogue");
        return { kind: "return" };
    }

    private engineCall(instruction: Instruction): Stmt[] | null {
        const entry = engineFunctionAt(instruction.opcode);
        if (entry === undefined) {
            throw new DecompileError(
                `opcode 0x${instruction.opcode.toString(16)} at ${instruction.address} is unknown`,
            );
        }
        if (entry.args === undefined) {
            throw new DecompileError(`'${entry.name}' has no recorded argument count`);
        }
        const args: Expr[] = [];
        for (let i = 0; i < entry.args; i++) {
            const position = entry.args - 1 - i;
            args.unshift(this.argument(entry.procArgs ?? 0, position));
        }
        if (entry.returns) {
            this.stack.push({ kind: "expr", expr: { kind: "libCall", opcode: instruction.opcode, args } });
            return null;
        }
        return [{ kind: "libStmt", opcode: instruction.opcode, args }];
    }

    /**
     * An argument in a procedure-taking position is a procedure reference rather than the number or
     * string it looks like: the slot number for a plain reference, the procedure's own name in the
     * string space for the by-name form.
     */
    private argument(procArgs: number, position: number): Expr {
        const value = this.pop(`argument ${position}`);
        const takesProcedure = (procArgs & (1 << position)) !== 0;
        if (!takesProcedure || value.kind !== "const") return this.toExpr(value);
        if (value.push === "int") return { kind: "procRef", index: value.raw - 1 };
        if (value.push === "str") {
            const text = this.stringAt(value.raw);
            const slot = this.procedureBySlot.findIndex((procedure) => procedure.name === text);
            if (slot > 0) return { kind: "procRef", index: slot - 1, stringify: true };
        }
        return this.toExpr(value);
    }

    private requireDepth(depth: number, what: string): void {
        if (this.stack.length === depth) return;
        const leftover = this.stack
            .slice(depth)
            .map((value) => (value.kind === "const" ? `${value.push} ${value.raw}` : describe(this.toExpr(value))))
            .join(", ");
        const at = this.code[this.at]?.address ?? "the end";
        throw new DecompileError(`${what} at ${at} left ${this.stack.length - depth} values on the stack: ${leftover}`);
    }

    /** String constants in the order the string space records them, which is the order they were written. */
    private stringOrder(): string[] {
        return [...this.file.strings].sort((a, b) => a[0] - b[0]).map(([, text]) => text);
    }
}

function constValue(instruction: Instruction): Value {
    const push = instruction.opcode === O_INTOP ? "int" : instruction.opcode === O_FLOATOP ? "float" : "str";
    return { kind: "const", push, raw: instruction.operand!, address: instruction.address };
}

function blockOf(statements: Stmt[]): Stmt {
    return { kind: "block", body: statements };
}

/** The statement a pending value would have been, or null when it cannot be one. */
function asStatement(value: Value): Stmt | null {
    if (value.kind === "branch") return value.statement;
    if (value.kind !== "expr" || value.expr.kind !== "libCall") return null;
    return { kind: "libStmt", opcode: value.expr.opcode, args: value.expr.args };
}

function blankVariable(name: string): VariableDecl {
    return { name, initial: { kind: "int", value: 0 } };
}

function asInitial(expr: Expr, what: string): VariableDecl["initial"] {
    if (expr.kind === "int" || expr.kind === "float" || expr.kind === "string") return expr;
    throw new DecompileError(`initial value of ${what} is not a constant: ${describe(expr)}`);
}

/** Enough of an expression to locate the mistake that produced it, without printing the whole tree. */
function describe(expr: Expr): string {
    if (expr.kind === "var") return `${expr.scope} '${expr.name}'`;
    if (expr.kind !== "libCall") return expr.kind;
    return `${engineFunctionAt(expr.opcode)?.name ?? `opcode 0x${expr.opcode.toString(16)}`}()`;
}

function argumentNames(count: number): string[] {
    return Array.from({ length: count }, (_, index) => `arg_${index}`);
}

function localName(slot: number): string {
    return `var_${slot}`;
}

/**
 * Every procedure ends with an implicit `return 0` and then its epilogue, both of which the emitter
 * writes unconditionally. Carrying them into the IR would make the next round trip emit them twice.
 */
function stripImplicitReturn(body: Stmt[]): Stmt[] {
    const trimmed = [...body];
    const last = trimmed[trimmed.length - 1];
    if (last?.kind === "return" && last.value === undefined) trimmed.pop();
    const beforeLast = trimmed[trimmed.length - 1];
    if (beforeLast?.kind === "return" && beforeLast.value?.kind === "int" && beforeLast.value.value === 0) {
        trimmed.pop();
    }
    return trimmed;
}

/** Rebuilds the IR a compiled INT was emitted from. */
export function decompileToProgram(bytes: Uint8Array): Program {
    return new Decompiler(readInt(bytes)).decompile();
}
