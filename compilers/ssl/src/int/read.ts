/**
 * Reads the INT container - the inverse of the emitter's file layout.
 *
 * The format carries no magic number and no section directory, so every boundary is derived from the
 * one before it: the procedure count sits at a fixed offset, the table's size follows from the count,
 * and each of the two tables states its own length. The entry-point longword patched into the startup
 * code is what marks where the tables end and executable code begins.
 *
 * This layer stops at the instruction boundary. It resolves the tables and hands back the byte range
 * holding code; decoding that range belongs to the disassembler.
 */

import { PROCTABLE_SIZE, P_CONDITIONAL, P_CRITICAL, P_EXPORT, P_IMPORT, P_INLINE, P_PURE, P_TIMED } from "./opcodes";

/** Fixed startup block. Its length is a constant the interpreter relies on. */
const HEADER_SIZE = 42;

/**
 * Where the startup code's jump operand lives. The push occupies bytes 10-15, of which the first two
 * are the opcode, so the address itself starts at 12.
 */
const ENTRY_POINT_AT = 12;

/** Both tables end with this longword; it also stands alone as the whole body of an empty table. */
const TABLE_TERMINATOR = 0xffffffff;

export class IntReadError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "IntReadError";
    }
}

export interface IntProcedureEntry {
    name: string;
    nameOffset: number;
    /** Raw type word; the booleans below are its decoded bits. */
    type: number;
    /** Firing time for a timed procedure, zero otherwise. */
    time: number;
    /** Address of the guard expression, or zero when the procedure has none. */
    conditionOffset: number;
    codeOffset: number;
    argCount: number;
    timed: boolean;
    conditional: boolean;
    imported: boolean;
    exported: boolean;
    critical: boolean;
    pure: boolean;
    inline: boolean;
}

export interface IntFile {
    bytes: Uint8Array;
    procedures: IntProcedureEntry[];
    /** Data offset to text, keyed exactly as the procedure table and push instructions reference them. */
    names: ReadonlyMap<number, string>;
    strings: ReadonlyMap<number, string>;
    /** First byte of the globals section, which is also the first executable byte after the tables. */
    globalsOffset: number;
}

function readWord(bytes: Uint8Array, at: number): number {
    if (at + 1 >= bytes.length) throw new IntReadError(`truncated word at ${at}`);
    return (bytes[at]! << 8) | bytes[at + 1]!;
}

/**
 * Longwords are read UNSIGNED. The top byte is multiplied rather than shifted because `<< 24` works
 * on a signed 32-bit value, so a high bit set there would come back negative.
 */
export function readLong(bytes: Uint8Array, at: number): number {
    if (at + 3 >= bytes.length) throw new IntReadError(`truncated longword at ${at}`);
    return bytes[at]! * 0x1000000 + ((bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!);
}

/** Operands that are counts or addresses read unsigned; integer constants are signed. */
export function toSigned(value: number): number {
    return value >= 0x80000000 ? value - 0x100000000 : value;
}

/**
 * Reads one table into a data-offset map, and returns where the next section starts.
 *
 * Offsets are counted from the table's own start including the 4-byte size prefix, which is why the
 * first record's data lands at 6 rather than 0. Text is decoded as latin1 because the format stores
 * bytes, not a declared encoding, and latin1 is the only lossless single-byte round trip.
 */
function readTable(bytes: Uint8Array, start: number): { entries: Map<number, string>; end: number } {
    const entries = new Map<number, string>();
    const size = readLong(bytes, start);
    if (size === TABLE_TERMINATOR) return { entries, end: start + 4 };

    const bodyEnd = start + 4 + size;
    if (bodyEnd + 4 > bytes.length) throw new IntReadError(`table at ${start} claims ${size} bytes past the file end`);

    let at = start + 4;
    while (at < bodyEnd) {
        const length = readWord(bytes, at);
        if (length === 0) throw new IntReadError(`zero-length table record at ${at}`);
        const dataStart = at + 2;
        if (dataStart + length > bodyEnd) throw new IntReadError(`table record at ${at} overruns its table`);
        let text = "";
        for (let i = dataStart; i < dataStart + length && bytes[i] !== 0; i++) text += String.fromCodePoint(bytes[i]!);
        entries.set(dataStart - start, text);
        at = dataStart + length;
    }
    return { entries, end: bodyEnd + 4 };
}

function nameAt(names: ReadonlyMap<number, string>, offset: number): string {
    const name = names.get(offset);
    if (name === undefined) throw new IntReadError(`procedure name offset ${offset} is not a namelist record`);
    return name;
}

/** Parses an INT file's container structure. Throws `IntReadError` on anything malformed. */
export function readInt(bytes: Uint8Array): IntFile {
    if (bytes.length < HEADER_SIZE + 4) throw new IntReadError("file is too short to hold a procedure table");

    const count = readLong(bytes, HEADER_SIZE);
    const tableStart = HEADER_SIZE + 4;
    const tableEnd = tableStart + count * PROCTABLE_SIZE * 4;
    if (tableEnd > bytes.length) throw new IntReadError(`procedure count ${count} overruns the file`);

    const namesRead = readTable(bytes, tableEnd);
    const stringsRead = readTable(bytes, namesRead.end);

    const procedures: IntProcedureEntry[] = [];
    for (let i = 0; i < count; i++) {
        const base = tableStart + i * PROCTABLE_SIZE * 4;
        const nameOffset = readLong(bytes, base);
        const type = readLong(bytes, base + 4);
        procedures.push({
            name: nameAt(namesRead.entries, nameOffset),
            nameOffset,
            type,
            time: readLong(bytes, base + 8),
            conditionOffset: readLong(bytes, base + 12),
            codeOffset: readLong(bytes, base + 16),
            argCount: readLong(bytes, base + 20),
            timed: (type & P_TIMED) !== 0,
            conditional: (type & P_CONDITIONAL) !== 0,
            imported: (type & P_IMPORT) !== 0,
            exported: (type & P_EXPORT) !== 0,
            critical: (type & P_CRITICAL) !== 0,
            pure: (type & P_PURE) !== 0,
            inline: (type & P_INLINE) !== 0,
        });
    }

    const globalsOffset = readLong(bytes, ENTRY_POINT_AT);
    if (globalsOffset !== stringsRead.end) {
        throw new IntReadError(
            `entry point ${globalsOffset} does not follow the string space (ends ${stringsRead.end})`,
        );
    }

    return { bytes, procedures, names: namesRead.entries, strings: stringsRead.entries, globalsOffset };
}
