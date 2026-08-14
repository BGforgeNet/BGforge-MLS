/**
 * Big-endian byte sink for INT output, with back-patching.
 *
 * The format is written in one forward pass with forward references left as zero longwords and filled
 * in once their target is known (jump targets, procedure-table code offsets, the entry-point address).
 * The reference emitter does this with fseek on an open file; a growable buffer is the same thing
 * without the syscalls, and it makes `tell()` exact rather than dependent on flush behaviour.
 */

import { O_FLOATOP, O_INTOP, O_STRINGOP } from "./opcodes";

export class IntWriter {
    private buffer: Uint8Array;
    private length = 0;

    constructor(initialCapacity = 4096) {
        this.buffer = new Uint8Array(initialCapacity);
    }

    /** Current write position, and the value a forward reference will later be patched to. */
    tell(): number {
        return this.length;
    }

    private ensure(extra: number): void {
        if (this.length + extra <= this.buffer.length) return;
        let capacity = this.buffer.length * 2;
        while (capacity < this.length + extra) capacity *= 2;
        const grown = new Uint8Array(capacity);
        grown.set(this.buffer.subarray(0, this.length));
        this.buffer = grown;
    }

    byte(value: number): void {
        this.ensure(1);
        this.buffer[this.length++] = value & 0xff;
    }

    word(value: number): void {
        this.byte(value >> 8);
        this.byte(value);
    }

    /**
     * Longwords are written as unsigned 32-bit. A negative operand emits its two's-complement form,
     * which the shifts below produce for free: `>>` coerces to int32 first, and each byte is masked on
     * the way out, so -1 becomes ff ff ff ff rather than a sign-extended mess.
     */
    long(value: number): void {
        this.byte(value >> 24);
        this.byte(value >> 16);
        this.byte(value >> 8);
        this.byte(value);
    }

    /** Overwrite a longword already written, leaving the write position where it was. */
    patchLong(at: number, value: number): void {
        this.buffer[at] = (value >> 24) & 0xff;
        this.buffer[at + 1] = (value >> 16) & 0xff;
        this.buffer[at + 2] = (value >> 8) & 0xff;
        this.buffer[at + 3] = value & 0xff;
    }

    bytes(source: Uint8Array): void {
        this.ensure(source.length);
        this.buffer.set(source, this.length);
        this.length += source.length;
    }

    op(opcode: number): void {
        this.word(opcode);
    }

    /** Push an integer constant: the typed opcode followed by its longword operand. */
    int(value: number): void {
        this.word(O_INTOP);
        this.long(value);
    }

    /** Push a float constant. The operand is the IEEE-754 bit pattern, not a decimal encoding. */
    float(value: number): void {
        this.word(O_FLOATOP);
        const bits = new DataView(new ArrayBuffer(4));
        bits.setFloat32(0, value, false);
        this.long(bits.getUint32(0, false));
    }

    /** Push a string constant. The operand is an offset into the string space, not the text. */
    string(offset: number): void {
        this.word(O_STRINGOP);
        this.long(offset);
    }

    toBytes(): Uint8Array {
        return this.buffer.slice(0, this.length);
    }
}
