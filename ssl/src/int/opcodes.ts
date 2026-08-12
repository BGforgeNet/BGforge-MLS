/**
 * Core VM opcodes for the Fallout INT bytecode.
 *
 * Opcode numbers are POSITIONAL - the VM dispatches on the value, so inserting a name in the middle
 * renumbers everything after it and invalidates every compiled script in existence. They are therefore
 * declared as an ordered list and the numbers derived from the index, rather than written out one by
 * one: a transcription slip can then only reorder a name, never silently assign a wrong number to a
 * correctly-spelled one.
 *
 * The list is the interpreter's own core opcode order, which is frozen by that same compatibility
 * constraint. Library and extended (sfall) opcodes are dispatched by number as named engine functions
 * rather than being instruction semantics, and live separately.
 */

/** Opcodes are 16-bit and all carry the operator bit. */
export const O_OPERATOR = 0x8000;

/** Constant-type bits, OR-ed into `O_CONST` to form the typed push opcodes. */
const O_INT = 0x4000;
const O_FLOAT = 0x2000;
const O_STRING = 0x1000;

/** Longwords per procedure-table entry: name, type, time, condition offset, code offset, arg count. */
export const PROCTABLE_SIZE = 6;

/**
 * Procedure-table type bits. Shared by the emitter and the reader so the two cannot drift: a bit
 * written under one name and read under another produces a file that round-trips through itself while
 * meaning something else to the engine.
 */
export const P_TIMED = 0x01;
export const P_CONDITIONAL = 0x02;
export const P_IMPORT = 0x04;
export const P_EXPORT = 0x08;
export const P_CRITICAL = 0x10;
export const P_PURE = 0x20;
export const P_INLINE = 0x40;

/** Every opcode is one big-endian word; offsets patched into the stream skip past it. */
export const OPCODE_SIZE = 2;

// Order is the contract. Do not sort, insert, or remove.
const CORE_OPCODES = [
    "NOOP",
    "CONST",
    "CRITICAL_START",
    "CRITICAL_DONE",
    "JMP",
    "CALL",
    "CALL_AT",
    "CALL_CONDITION",
    "CALLSTART",
    "EXEC",
    "SPAWN",
    "FORK",
    "A_TO_D",
    "D_TO_A",
    "EXIT",
    "DETACH",
    "EXIT_PROG",
    "STOP_PROG",
    "FETCH_GLOBAL",
    "STORE_GLOBAL",
    "FETCH_EXTERNAL",
    "STORE_EXTERNAL",
    "EXPORT_VAR",
    "EXPORT_PROC",
    "SWAP",
    "SWAPA",
    "POP",
    "DUP",
    "POP_RETURN",
    "POP_EXIT",
    "POP_ADDRESS",
    "POP_FLAGS",
    "POP_FLAGS_RETURN",
    "POP_FLAGS_EXIT",
    "POP_FLAGS_RETURN_EXTERN",
    "POP_FLAGS_EXIT_EXTERN",
    "POP_FLAGS_RETURN_VAL_EXTERN",
    "POP_FLAGS_RETURN_VAL_EXIT",
    "POP_FLAGS_RETURN_VAL_EXIT_EXTERN",
    "CHECK_ARG_COUNT",
    "LOOKUP_STRING_PROC",
    "POP_BASE",
    "POP_TO_BASE",
    "PUSH_BASE",
    "SET_GLOBAL",
    "FETCH_PROC_ADDRESS",
    "DUMP",
    "IF",
    "WHILE",
    "STORE",
    "FETCH",
    "EQUAL",
    "NOT_EQUAL",
    "LESS_EQUAL",
    "GREATER_EQUAL",
    "LESS",
    "GREATER",
    "ADD",
    "SUB",
    "MUL",
    "DIV",
    "MOD",
    "AND",
    "OR",
    "BWAND",
    "BWOR",
    "BWXOR",
    "BWNOT",
    "FLOOR",
    "NOT",
    "NEGATE",
    "WAIT",
    "CANCEL",
    "CANCELALL",
    "STARTCRITICAL",
    "ENDCRITICAL",
] as const;

export type CoreOpcodeName = (typeof CORE_OPCODES)[number];

function buildTable(): Readonly<Record<CoreOpcodeName, number>> {
    const table = {} as Record<CoreOpcodeName, number>;
    CORE_OPCODES.forEach((name, index) => {
        table[name] = O_OPERATOR + index;
    });
    return table;
}

/** Core opcodes by name, e.g. `Op.CRITICAL_START`. */
export const Op = buildTable();

/** Typed constant-push opcodes. The operand follows as one big-endian longword. */
export const O_INTOP = Op.CONST | O_INT;
export const O_FLOATOP = Op.CONST | O_FLOAT;
export const O_STRINGOP = Op.CONST | O_STRING;

/** Reverse lookup for diagnostics and the differential's mismatch reports. */
export function opcodeName(value: number): string | undefined {
    const index = value - O_OPERATOR;
    return index >= 0 && index < CORE_OPCODES.length ? CORE_OPCODES[index] : undefined;
}
