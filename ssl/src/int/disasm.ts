/**
 * Decodes the INT instruction stream.
 *
 * Instruction lengths are self-describing: every opcode is one big-endian word, and only the three
 * typed constant pushes carry an operand. A linear sweep is therefore exact rather than a guess - the
 * format interleaves no data with code, because the name and string tables sit in their own sections
 * ahead of the first executable byte.
 *
 * Operand values are left raw here. A longword can be a signed integer, a float bit pattern, a string
 * offset or a code address depending on which opcode consumes it, and only the consumer knows which -
 * so resolution belongs to the caller, and the formatter below does it for display.
 */

import { O_FLOATOP, O_INTOP, O_STRINGOP, OPCODE_SIZE, opcodeName } from "./opcodes";
import { engineOpcodeName } from "./opcodes-engine";
import { readLong, toSigned, type IntFile } from "./read";

/** Bytes an operand-carrying instruction occupies: the opcode word plus its longword. */
const PUSH_SIZE = OPCODE_SIZE + 4;

export interface Instruction {
    address: number;
    opcode: number;
    /** Raw longword, present only for the constant-push opcodes. */
    operand?: number;
    size: number;
}

export function isPush(opcode: number): boolean {
    return opcode === O_INTOP || opcode === O_FLOATOP || opcode === O_STRINGOP;
}

/** Reinterprets a longword as the float it encodes. */
export function toFloat(operand: number): number {
    const view = new DataView(new ArrayBuffer(4));
    view.setUint32(0, operand, false);
    return view.getFloat32(0, false);
}

/** Decodes `[from, to)` as instructions. A trailing odd byte is a malformed file and throws. */
export function decodeRange(bytes: Uint8Array, from: number, to: number): Instruction[] {
    const out: Instruction[] = [];
    let at = from;
    while (at < to) {
        if (at + OPCODE_SIZE > to) throw new Error(`truncated opcode at ${at}`);
        const opcode = (bytes[at]! << 8) | bytes[at + 1]!;
        if (!isPush(opcode)) {
            out.push({ address: at, opcode, size: OPCODE_SIZE });
            at += OPCODE_SIZE;
            continue;
        }
        if (at + PUSH_SIZE > to) throw new Error(`truncated push operand at ${at}`);
        out.push({ address: at, opcode, operand: readLong(bytes, at + OPCODE_SIZE), size: PUSH_SIZE });
        at += PUSH_SIZE;
    }
    return out;
}

/** Every instruction from the start of the globals section to the end of the file. */
export function decodeCode(file: IntFile): Instruction[] {
    return decodeRange(file.bytes, file.globalsOffset, file.bytes.length);
}

/** Name for any opcode, falling back to hex so an unknown one is still readable rather than dropped. */
export function mnemonic(opcode: number, game: 1 | 2 = 2): string {
    return opcodeName(opcode) ?? engineOpcodeName(opcode, game) ?? `op_0x${opcode.toString(16).padStart(4, "0")}`;
}

/** How a push's operand is spelled when nothing downstream has claimed it as an address. */
function pushText(instruction: Instruction, file: IntFile): string {
    const operand = instruction.operand ?? 0;
    switch (instruction.opcode) {
        case O_INTOP:
            return `push.int ${toSigned(operand)}`;
        case O_FLOATOP:
            return `push.float ${toFloat(operand)}`;
        default: {
            const text = file.strings.get(operand);
            return `push.str ${text === undefined ? `@${operand}` : JSON.stringify(text)}`;
        }
    }
}

/**
 * Renders the whole code region as an assembly listing.
 *
 * This is the honest floor for viewing an INT: it needs no control-flow reconstruction, so it works on
 * any file including ones the decompiler cannot structure, and it is what the decompiler falls back to
 * for a region it will not claim to understand.
 */
export function formatDisassembly(file: IntFile, game: 1 | 2 = 2): string {
    const instructions = decodeCode(file);
    const procedureAt = new Map<number, string>();
    for (const procedure of file.procedures) {
        if (!procedure.imported) procedureAt.set(procedure.codeOffset, procedure.name);
        if (procedure.conditional) procedureAt.set(procedure.conditionOffset, `${procedure.name} (condition)`);
    }

    const lines: string[] = [`; globals section at ${file.globalsOffset}`];
    for (const instruction of instructions) {
        const label = procedureAt.get(instruction.address);
        if (label !== undefined) lines.push("", `${label}:`);
        const text = isPush(instruction.opcode) ? pushText(instruction, file) : mnemonic(instruction.opcode, game);
        lines.push(`  ${String(instruction.address).padStart(6)}  ${text}`);
    }
    return lines.join("\n");
}
