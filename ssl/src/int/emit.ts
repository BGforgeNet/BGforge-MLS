/**
 * Emits Fallout INT bytecode from the typed IR.
 *
 * File layout, in write order:
 *   1. 42 bytes of fixed startup code. Its length is a constant the interpreter relies on, so nothing
 *      may be added to it.
 *   2. Procedure table - a count followed by six longwords per procedure.
 *   3. Namelist, then string space.
 *   4. Globals section, ending in a jump to the `start` procedure.
 *   5. Procedure bodies.
 *
 * Forward references (jump targets, the entry point, per-procedure code offsets) are written as zero
 * longwords and patched once known, which is why the writer exposes `tell` and `patchLong`.
 */

import { OPCODE_SIZE, Op, PROCTABLE_SIZE } from "./opcodes";
import { EngineOp } from "./opcodes-engine";
import { NameTable } from "./namelist";
import { IntWriter } from "./writer";
import {
    externalsOf,
    globalsOf,
    proceduresOf,
    type AssignOp,
    type BinaryOp,
    type Expr,
    type Program,
    type ProcedureDecl,
    type Stmt,
    type UnaryOp,
    type VariableDecl,
} from "./ir";

/** Procedure-table type bits. */
const P_TIMED = 0x01;
const P_CONDITIONAL = 0x02;
const P_IMPORT = 0x04;
const P_EXPORT = 0x08;
const P_CRITICAL = 0x10;
const P_PURE = 0x20;
const P_INLINE = 0x40;

/**
 * A placeholder occupies procedure slot 0 so that no real procedure can sit at table offset zero,
 * which the engine treats as absent. Its name is part of the output, not an internal detail.
 */
const PLACEHOLDER_NAME = "..............";

/** Address of the exit instruction inside the startup code, jumped to when `start` returns. */
const EXIT_ADDRESS = 18;

const BINARY_OPCODES: Partial<Record<BinaryOp, number>> = {
    "+": Op.ADD,
    "-": Op.SUB,
    "*": Op.MUL,
    "/": Op.DIV,
    "%": Op.MOD,
    "==": Op.EQUAL,
    "!=": Op.NOT_EQUAL,
    "<=": Op.LESS_EQUAL,
    ">=": Op.GREATER_EQUAL,
    "<": Op.LESS,
    ">": Op.GREATER,
    // Integer division and exponentiation are sfall additions, not core instructions.
    div: EngineOp.TS_DIV,
    "^": EngineOp.TS_POW,
    bwand: Op.BWAND,
    bwor: Op.BWOR,
    bwxor: Op.BWXOR,
};

const UNARY_OPCODES: Record<UnaryOp, number> = {
    not: Op.NOT,
    bwnot: Op.BWNOT,
    negate: Op.NEGATE,
    floor: Op.FLOOR,
};

const COMPOUND_OPCODES: Partial<Record<AssignOp, number>> = {
    "+=": Op.ADD,
    "-=": Op.SUB,
    "*=": Op.MUL,
    "/=": Op.DIV,
};

export class EmitError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "EmitError";
    }
}

export interface EmitOptions {
    /**
     * Compile `and`/`or` so the right operand is skipped when the left already decides the result.
     * Off by default, matching the language's own default; the source-level pragma and the equivalent
     * command-line flag both turn it on, and it changes emitted bytes rather than just performance.
     */
    shortCircuit?: boolean;
}

interface LoopFrame {
    /** Where `continue` jumps by default - the loop's condition test. */
    startPos: number;
    /** Continue sites awaiting a patch, used by counted loops whose increment runs first. */
    pendingContinues: number[];
}

class Emitter {
    private readonly w = new IntWriter();
    private readonly names = new NameTable();
    private readonly strings = new NameTable();
    private readonly loops: LoopFrame[] = [];
    private readonly shortCircuit: boolean;

    /** Procedures including the slot-0 placeholder; indices in the IR are shifted by one. */
    private readonly procedures: ProcedureDecl[];
    private readonly globals: VariableDecl[];
    private readonly externals: VariableDecl[];
    private procTableStart = 0;
    private currentProcedure: ProcedureDecl | null = null;

    private readonly program: Program;

    constructor(program: Program, options: EmitOptions) {
        this.program = program;
        this.shortCircuit = options.shortCircuit ?? false;
        const placeholder: ProcedureDecl = { name: PLACEHOLDER_NAME, args: [], locals: [], body: [] };
        this.procedures = [placeholder, ...proceduresOf(program)];
        this.globals = globalsOf(program);
        this.externals = externalsOf(program);
    }

    emit(): Uint8Array {
        this.internNames();
        this.internStrings();
        const entryPatch = this.writeStartupCode();
        this.procTableStart = this.w.tell();
        this.writeProcedureTable();
        this.w.bytes(this.names.toBytes());
        this.w.bytes(this.strings.toBytes());

        this.w.patchLong(entryPatch, this.w.tell());
        const startPatch = this.writeGlobals();
        const startOffset = this.writeProcedures();

        // A script with no `start` keeps the placeholder jump to the exit instruction, so loading one
        // is harmless rather than a crash. The reference warns here; the front end owns diagnostics.
        if (startOffset !== null) this.w.patchLong(startPatch, startOffset);
        return this.w.toBytes();
    }

    /**
     * Both tables are built before any output, because each is written in full at a fixed point in the
     * file and the single forward pass cannot go back and grow one. Interning order fixes the offsets,
     * and the offsets are baked into the procedure table and into every string-push instruction, so the
     * walk below reproduces source declaration order exactly. The placeholder is interned first because
     * it exists before parsing begins.
     */
    private internNames(): void {
        this.names.intern(PLACEHOLDER_NAME);
        for (const declaration of this.program.declarations) {
            if (declaration.kind === "procedure") this.names.intern(declaration.procedure.name);
            else this.names.intern(declaration.variable.name);
        }
    }

    /**
     * String constants are interned in the order the source mentions them, which for a procedure means
     * its guard expression, then its local initialisers, then its body - the textual order, not the
     * order the emitter later writes them in.
     */
    private internStrings(): void {
        const value = (expr: Expr): void => {
            switch (expr.kind) {
                case "string":
                    this.strings.intern(expr.value);
                    break;
                case "procRef":
                    if (expr.stringify) this.strings.intern(this.procedures[expr.index + 1]?.name ?? "");
                    break;
                case "unary":
                    value(expr.operand);
                    break;
                case "binary":
                    value(expr.left);
                    value(expr.right);
                    break;
                case "ternary":
                    value(expr.cond);
                    value(expr.whenTrue);
                    value(expr.whenFalse);
                    break;
                case "call":
                    value(expr.target);
                    expr.args.forEach(value);
                    break;
                case "libCall":
                    expr.args.forEach(value);
                    break;
            }
        };
        const statement = (stmt: Stmt): void => {
            switch (stmt.kind) {
                case "block":
                    stmt.body.forEach(statement);
                    break;
                case "expr":
                    value(stmt.expr);
                    break;
                case "assign":
                    value(stmt.target);
                    value(stmt.value);
                    break;
                case "if":
                    value(stmt.cond);
                    statement(stmt.thenBranch);
                    if (stmt.elseBranch) statement(stmt.elseBranch);
                    break;
                case "while":
                    value(stmt.cond);
                    statement(stmt.body);
                    break;
                case "return":
                    if (stmt.value) value(stmt.value);
                    break;
                case "callStmt":
                    value(stmt.target);
                    stmt.args.forEach(value);
                    break;
                case "libStmt":
                    stmt.args.forEach(value);
                    break;
            }
        };

        for (const declaration of this.program.declarations) {
            if (declaration.kind !== "procedure") {
                value(declaration.variable.initial);
                continue;
            }
            const procedure = declaration.procedure;
            if (procedure.conditional) value(procedure.conditional);
            for (const local of procedure.locals) value(local.initial);
            procedure.body.forEach(statement);
        }
    }

    /**
     * The startup code pushes the address of the exit instruction, then jumps to the globals section.
     * When `start` returns it pops that address and exits. Exactly 42 bytes - the interpreter hardcodes
     * the length, so this block cannot grow.
     */
    private writeStartupCode(): number {
        this.w.op(Op.CRITICAL_START); // 0
        this.w.int(EXIT_ADDRESS); // 2
        this.w.op(Op.D_TO_A); // 8

        const entryPatch = this.w.tell() + OPCODE_SIZE;
        this.w.int(0); // 10, patched to the globals section
        this.w.op(Op.JMP); // 16

        this.w.op(Op.EXIT_PROG); // 18, reached when start returns

        this.w.op(Op.POP); // 20
        this.w.op(Op.POP_FLAGS_RETURN);
        this.w.op(Op.POP); // 24
        this.w.op(Op.POP_FLAGS_EXIT);
        this.w.op(Op.POP); // 28
        this.w.op(Op.POP_FLAGS_RETURN_EXTERN);
        this.w.op(Op.POP); // 32
        this.w.op(Op.POP_FLAGS_EXIT_EXTERN);
        this.w.op(Op.POP_FLAGS_RETURN_VAL_EXTERN); // 36
        this.w.op(Op.POP_FLAGS_RETURN_VAL_EXIT); // 38
        this.w.op(Op.POP_FLAGS_RETURN_VAL_EXIT_EXTERN); // 40

        return entryPatch;
    }

    private procedureType(procedure: ProcedureDecl): number {
        let type = 0;
        if (procedure.timed !== undefined) type |= P_TIMED;
        if (procedure.conditional) type |= P_CONDITIONAL;
        if (procedure.imported) type |= P_IMPORT;
        if (procedure.exported) type |= P_EXPORT;
        if (procedure.critical) type |= P_CRITICAL;
        if (procedure.pure) type |= P_PURE;
        if (procedure.inline) type |= P_INLINE;
        return type;
    }

    private writeProcedureTable(): void {
        this.w.long(this.procedures.length);
        for (const procedure of this.procedures) {
            this.w.long(this.names.offsetOf(procedure.name));
            this.w.long(this.procedureType(procedure));
            this.w.long(procedure.timed ?? 0);
            this.w.long(0); // condition offset, patched when the body is written
            this.w.long(0); // code offset, patched when the body is written
            this.w.long(procedure.args.length);
        }
    }

    /** Patches one longword of one procedure-table entry, skipping the leading count. */
    private patchProcTableEntry(which: number, element: number, value: number): void {
        this.w.patchLong(this.procTableStart + 4 + which * 4 * PROCTABLE_SIZE + element * 4, value);
    }

    /** Returns the patch site for the entry-point jump, filled in once `start`'s offset is known. */
    private writeGlobals(): number {
        this.w.op(Op.SET_GLOBAL);
        for (const global of this.globals) this.writeInitialValue(global);

        for (const external of this.externals) {
            if (!external.exported) continue;
            this.w.string(this.names.offsetOf(external.name));
            this.w.op(Op.EXPORT_VAR);
        }
        for (const external of this.externals) {
            if (!external.exported) continue;
            this.writeInitialValue(external);
            this.w.string(this.names.offsetOf(external.name));
            this.w.op(Op.STORE_EXTERNAL);
        }
        this.procedures.forEach((procedure, index) => {
            if (!procedure.exported) return;
            this.w.int(procedure.args.length);
            this.w.int(index);
            this.w.op(Op.EXPORT_PROC);
        });

        this.w.int(0); // argument count for the starting procedure
        this.w.op(Op.CRITICAL_DONE);
        const startPatch = this.w.tell() + OPCODE_SIZE;
        this.w.int(EXIT_ADDRESS); // stands in until `start` is located
        this.w.op(Op.JMP);
        return startPatch;
    }

    private writeInitialValue(variable: VariableDecl): void {
        const initial = variable.initial;
        switch (initial.kind) {
            case "int":
                this.w.int(initial.value);
                break;
            case "float":
                this.w.float(initial.value);
                break;
            case "string":
                this.w.string(this.strings.offsetOf(initial.value));
                break;
        }
    }

    /** Returns the offset of `start`, or null when the program declares none. */
    private writeProcedures(): number | null {
        let startOffset: number | null = null;
        this.procedures.forEach((procedure, index) => {
            if (procedure.name.toLowerCase() === "start") startOffset = this.w.tell();
            if (procedure.imported) return;
            this.patchProcTableEntry(index, 4, this.w.tell());
            this.writeProcedure(procedure, index);
        });
        return startOffset;
    }

    private writeProcedure(procedure: ProcedureDecl, index: number): void {
        // The placeholder has no body and must not emit one; its table offset still points here.
        if (procedure.name === PLACEHOLDER_NAME && procedure.body.length === 0) return;

        if (procedure.conditional) {
            const jumpPatch = this.w.tell() + OPCODE_SIZE;
            this.w.int(0);
            this.w.op(Op.JMP);
            const conditionAt = this.w.tell();
            this.w.op(Op.CRITICAL_START);
            this.writeExpression(procedure.conditional);
            this.w.op(Op.CRITICAL_DONE);
            this.w.op(Op.STOP_PROG);
            this.w.patchLong(jumpPatch, this.w.tell());
            this.patchProcTableEntry(index, 3, conditionAt);
        }

        this.w.op(Op.PUSH_BASE);
        // Arguments arrive on the stack already; only the declared locals are initialised here.
        for (const local of procedure.locals) this.writeInitialValue(local);

        this.currentProcedure = procedure;
        for (const statement of procedure.body) this.writeStatement(statement);

        // Every procedure ends with an implicit `return 0`, so falling off the end behaves like an
        // explicit return rather than running into the next procedure's code.
        this.writeReturn({ kind: "int", value: 0 });

        this.w.op(Op.POP_TO_BASE);
        this.w.op(Op.POP_BASE);
        if (procedure.critical) this.w.op(Op.CRITICAL_DONE);
        this.w.op(Op.POP_RETURN);
        this.currentProcedure = null;
    }

    private writeReturn(value: Expr | undefined): void {
        if (value) {
            this.writeExpression(value);
            this.w.op(Op.D_TO_A);
            this.w.op(Op.SWAPA);
        }
        this.w.op(Op.POP_TO_BASE);
        this.w.op(Op.POP_BASE);
        if (value) this.w.op(Op.A_TO_D);
        if (this.currentProcedure?.critical) this.w.op(Op.CRITICAL_DONE);
        this.w.op(Op.POP_RETURN);
    }

    private writeStatement(statement: Stmt): void {
        switch (statement.kind) {
            case "block":
                for (const inner of statement.body) this.writeStatement(inner);
                break;

            case "expr":
                this.writeExpression(statement.expr);
                break;

            case "assign":
                this.writeAssign(statement);
                break;

            case "if":
                this.writeIf(statement);
                break;

            case "while":
                this.writeWhile(statement);
                break;

            case "return":
                this.writeReturn(statement.value);
                break;

            case "break":
                // Every loop leaves its exit address on the stack for the condition test, so a break
                // is a bare jump that consumes it.
                this.w.op(Op.JMP);
                break;

            case "continue": {
                const frame = this.currentLoop("continue");
                frame.pendingContinues.push(this.w.tell() + OPCODE_SIZE);
                this.w.int(frame.startPos);
                this.w.op(Op.JMP);
                break;
            }

            case "loopEnd": {
                const frame = this.currentLoop("loopEnd");
                const here = this.w.tell();
                for (const site of frame.pendingContinues) this.w.patchLong(site, here);
                frame.pendingContinues = [];
                break;
            }

            case "callStmt":
                this.writeCall(statement.target, statement.args, statement.checkArgCount ?? false);
                this.w.op(Op.POP);
                break;

            case "libStmt":
                for (const argument of statement.args) this.writeExpression(argument);
                this.w.op(statement.opcode);
                if (statement.popsResult) this.w.op(Op.POP);
                break;
        }
    }

    private currentLoop(what: string): LoopFrame {
        const frame = this.loops[this.loops.length - 1];
        if (!frame) throw new EmitError(`'${what}' outside a loop`);
        return frame;
    }

    private writeAssign(statement: Extract<Stmt, { kind: "assign" }>): void {
        const target = statement.target;
        if (statement.op !== "=") {
            const opcode = COMPOUND_OPCODES[statement.op];
            if (opcode === undefined) throw new EmitError(`unsupported compound assignment '${statement.op}'`);
            this.writeFetch(target);
            this.writeExpression(statement.value);
            this.w.op(opcode);
        } else {
            this.writeExpression(statement.value);
        }
        this.writeStore(target);
    }

    private writeFetch(target: Extract<Expr, { kind: "var" }>): void {
        switch (target.scope) {
            case "local":
                this.w.int(target.index);
                this.w.op(Op.FETCH);
                break;
            case "global":
                this.w.int(target.index);
                this.w.op(Op.FETCH_GLOBAL);
                break;
            case "external":
                this.w.string(this.names.offsetOf(target.name));
                this.w.op(Op.FETCH_EXTERNAL);
                break;
        }
    }

    private writeStore(target: Extract<Expr, { kind: "var" }>): void {
        switch (target.scope) {
            case "local":
                this.w.int(target.index);
                this.w.op(Op.STORE);
                break;
            case "global":
                this.w.int(target.index);
                this.w.op(Op.STORE_GLOBAL);
                break;
            case "external":
                this.w.string(this.names.offsetOf(target.name));
                this.w.op(Op.STORE_EXTERNAL);
                break;
        }
    }

    private writeIf(statement: Extract<Stmt, { kind: "if" }>): void {
        const falsePatch = this.w.tell() + OPCODE_SIZE;
        this.w.int(0);
        this.writeExpression(statement.cond);
        this.w.op(Op.IF);
        this.writeStatement(statement.thenBranch);

        if (!statement.elseBranch) {
            this.w.patchLong(falsePatch, this.w.tell());
            return;
        }
        const endPatch = this.w.tell() + OPCODE_SIZE;
        this.w.int(0);
        this.w.op(Op.JMP);
        this.w.patchLong(falsePatch, this.w.tell());
        this.writeStatement(statement.elseBranch);
        this.w.patchLong(endPatch, this.w.tell());
    }

    private writeWhile(statement: Extract<Stmt, { kind: "while" }>): void {
        const falsePatch = this.w.tell() + OPCODE_SIZE;
        this.w.int(0);
        const top = this.w.tell();
        this.loops.push({ startPos: top, pendingContinues: [] });

        this.writeExpression(statement.cond);
        this.w.op(Op.WHILE);
        this.writeStatement(statement.body);
        this.w.int(top);
        this.w.op(Op.JMP);
        this.w.patchLong(falsePatch, this.w.tell());

        // A plain while needs no continue patching: continues already jump to the condition test.
        this.loops.pop();
    }

    private writeExpression(expr: Expr): void {
        switch (expr.kind) {
            case "int":
                this.w.int(expr.value);
                break;

            case "float":
                this.w.float(expr.value);
                break;

            case "string":
                this.w.string(this.strings.offsetOf(expr.value));
                break;

            case "var":
                this.writeFetch(expr);
                break;

            case "procRef":
                if (expr.stringify) this.w.string(this.strings.offsetOf(this.procedures[expr.index + 1]?.name ?? ""));
                else this.w.int(expr.index + 1);
                break;

            case "unary":
                this.writeExpression(expr.operand);
                this.w.op(UNARY_OPCODES[expr.op]);
                break;

            case "binary":
                this.writeBinary(expr);
                break;

            case "ternary":
                this.writeTernary(expr);
                break;

            case "call":
                this.writeCall(expr.target, expr.args, expr.checkArgCount ?? false);
                break;

            case "libCall":
                for (const argument of expr.args) this.writeExpression(argument);
                this.w.op(expr.opcode);
                break;
        }
    }

    private writeBinary(expr: Extract<Expr, { kind: "binary" }>): void {
        if (expr.op === "and" || expr.op === "or" || expr.op === "andalso" || expr.op === "orelse") {
            this.writeLogical(expr);
            return;
        }
        const opcode = BINARY_OPCODES[expr.op];
        if (opcode === undefined) throw new EmitError(`operator '${expr.op}' has no core opcode`);
        this.writeExpression(expr.left);
        this.writeExpression(expr.right);
        this.w.op(opcode);
    }

    /**
     * Short-circuit form duplicates the left result and jumps past the right operand when it already
     * decides the outcome, so the duplicate becomes the expression's value. The non-short-circuit form
     * evaluates both sides unconditionally, which matters when the right side has side effects.
     */
    private writeLogical(expr: Extract<Expr, { kind: "binary" }>): void {
        // `andalso`/`orelse` are the explicitly short-circuiting spellings and ignore the mode.
        const explicit = expr.op === "andalso" || expr.op === "orelse";
        const isOr = expr.op === "or" || expr.op === "orelse";
        this.writeExpression(expr.left);
        if (!this.shortCircuit && !explicit) {
            this.writeExpression(expr.right);
            this.w.op(isOr ? Op.OR : Op.AND);
            return;
        }
        this.w.op(Op.DUP);
        const skipPatch = this.w.tell() + OPCODE_SIZE;
        this.w.int(0);
        this.w.op(Op.SWAP);
        if (isOr) this.w.op(Op.NOT);
        this.w.op(Op.IF);
        this.w.op(Op.POP);
        this.writeExpression(expr.right);
        this.w.patchLong(skipPatch, this.w.tell());
    }

    private writeTernary(expr: Extract<Expr, { kind: "ternary" }>): void {
        const elsePatch = this.w.tell() + OPCODE_SIZE;
        this.w.int(0);
        this.writeExpression(expr.cond);
        this.w.op(Op.IF);
        this.writeExpression(expr.whenTrue);
        const endPatch = this.w.tell() + OPCODE_SIZE;
        this.w.int(0);
        this.w.op(Op.JMP);
        this.w.patchLong(elsePatch, this.w.tell());
        this.writeExpression(expr.whenFalse);
        this.w.patchLong(endPatch, this.w.tell());
    }

    /**
     * A call pushes its own return address first, then the arguments and their count, then the
     * procedure address. The return address is only known after the call instruction is written, so it
     * is patched back into the leading push.
     */
    private writeCall(target: Expr, args: Expr[], checkArgCount: boolean): void {
        const returnPatch = this.w.tell() + OPCODE_SIZE;
        this.w.int(0);
        this.w.op(Op.D_TO_A);

        for (const argument of args) this.writeExpression(argument);
        this.w.int(args.length);

        this.writeProcAddress(target);

        if (checkArgCount) {
            this.w.op(Op.DUP);
            this.w.int(args.length);
            this.w.op(Op.CHECK_ARG_COUNT);
        }
        this.w.op(Op.CALL);
        this.w.patchLong(returnPatch, this.w.tell());
    }

    /**
     * A call through a variable cannot be resolved at compile time, so the address is fetched and run
     * through the name lookup the engine expects; a direct procedure reference needs neither.
     */
    private writeProcAddress(target: Expr): void {
        if (target.kind === "procRef") {
            this.w.int(target.index + 1);
            return;
        }
        if (target.kind === "string") {
            this.w.string(this.strings.offsetOf(target.value));
            this.w.op(Op.LOOKUP_STRING_PROC);
            return;
        }
        if (target.kind === "var") {
            this.writeFetch(target);
            this.w.op(Op.LOOKUP_STRING_PROC);
            return;
        }
        throw new EmitError(`cannot call a '${target.kind}' expression`);
    }
}

/** Compiles a program tree to INT bytecode. */
export function emitInt(program: Program, options: EmitOptions = {}): Uint8Array {
    return new Emitter(program, options).emit();
}
