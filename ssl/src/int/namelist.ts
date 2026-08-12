/**
 * Name and string tables for INT output.
 *
 * Both the procedure/variable namelist and the string space use one encoding: a longword holding the
 * total size of the entries, then a run of `(word length, length bytes)` records, then a `0xffffffff`
 * terminator. A record's length is the string plus its NUL terminator rounded UP TO EVEN, with the
 * padding zero-filled - so a 5-character name occupies 6 bytes and a 4-character one also occupies 6.
 *
 * The offset handed to the rest of the emitter points at a record's DATA, counted from the start of
 * the table including its 4-byte size prefix. That is why the first record's data sits at offset 6 and
 * not 0: 4 bytes of size, 2 bytes of length word. Offsets are baked into the procedure table and into
 * every string-push instruction, so this arithmetic is load-bearing rather than presentational.
 *
 * Interning is by exact bytes: a name used twice yields one record and one offset.
 */

/** Records are padded so every entry begins on an even boundary. */
function paddedLength(byteLength: number): number {
    const withTerminator = byteLength + 1;
    return withTerminator % 2 === 0 ? withTerminator : withTerminator + 1;
}

export class NameTable {
    private readonly offsets = new Map<string, number>();
    private readonly records: Uint8Array[] = [];
    /** Starts past the size longword, so the first record's data lands at 6. */
    private cursor = 4;

    /** Interns a name and returns the offset of its data. */
    intern(name: string): number {
        const existing = this.offsets.get(name);
        if (existing !== undefined) return existing;

        const text = Buffer.from(name, "latin1");
        const length = paddedLength(text.length);
        const record = new Uint8Array(2 + length);
        record[0] = (length >> 8) & 0xff;
        record[1] = length & 0xff;
        record.set(text, 2);

        const dataOffset = this.cursor + 2;
        this.offsets.set(name, dataOffset);
        this.records.push(record);
        this.cursor += record.length;
        return dataOffset;
    }

    /** True when nothing was interned; an empty table is written as the terminator alone. */
    get isEmpty(): boolean {
        return this.records.length === 0;
    }

    /** Total bytes of the records, which is the value of the size longword. */
    get entriesLength(): number {
        return this.cursor - 4;
    }

    /**
     * Serialized form, size prefix included. An empty table emits no prefix at all - the reference
     * emitter skips the whole body when its namelist pointer is null, so a table that was never
     * written to is four terminator bytes and nothing else.
     */
    toBytes(): Uint8Array {
        const terminator = Uint8Array.from([0xff, 0xff, 0xff, 0xff]);
        if (this.isEmpty) return terminator;

        const size = this.entriesLength;
        const out = new Uint8Array(4 + size + 4);
        out[0] = (size >>> 24) & 0xff;
        out[1] = (size >>> 16) & 0xff;
        out[2] = (size >>> 8) & 0xff;
        out[3] = size & 0xff;
        let at = 4;
        for (const record of this.records) {
            out.set(record, at);
            at += record.length;
        }
        out.set(terminator, at);
        return out;
    }
}
