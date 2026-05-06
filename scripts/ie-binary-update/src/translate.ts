import type { OffsetItem } from "../../ie-update/src/ie/types.ts";

export interface TranslatedField {
    readonly name: string;
    readonly fieldSource: string;
    /** Identifiers the emitted source depends on — typed-binary codecs, spec helpers. */
    readonly imports: ReadonlyArray<string>;
}

export interface TranslatedStruct {
    readonly fields: ReadonlyArray<TranslatedField>;
    readonly imports: ReadonlySet<string>;
}

/** camelCase a list of pre-split words. First word lowercase, rest title-case. */
function camelCaseWords(words: readonly string[], source: string): string {
    if (words.length === 0) {
        throw new Error(`Cannot derive identifier from ${JSON.stringify(source)}`);
    }
    const [first, ...rest] = words;
    const head = first!.toLowerCase();
    const tail = rest.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("");
    const id = head + tail;
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id)) {
        throw new Error(`Bad derived identifier "${id}" from ${JSON.stringify(source)}`);
    }
    return id;
}

/** Normalises an IESDP snake_case id (or already-camelCase) to camelCase. */
export function snakeToCamel(id: string): string {
    return camelCaseWords(id.split(/_+/).filter(Boolean), id);
}

/**
 * Converts an IESDP `desc` to a camelCase TypeScript identifier.
 *
 * Strips Markdown link syntax `[text](url)` keeping the text, removes HTML
 * tags via repeat-until-stable for nested cases, drops parentheticals (file
 * format hints like `(BAM)`), then camelCases the remaining whitespace-split
 * words.
 */
export function descToCamelCase(desc: string): string {
    let cleaned = desc;
    cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

    // Repeat-until-stable strip — handles nested tags like `<a<b>>` that a
    // single greedy pass would leave residue from.
    let prev: string;
    do {
        prev = cleaned;
        cleaned = cleaned.replace(/<[^<>]*>/g, "");
    } while (cleaned !== prev);

    cleaned = cleaned.replace(/\([^)]*\)/g, "");
    return camelCaseWords(cleaned.trim().split(/\s+/).filter(Boolean), desc);
}

/**
 * IESDP scalar type → typed-binary codec name.
 *
 * `strref` is signed (`i32`) so the −1 "no string" sentinel reads naturally
 * (binary/INTERNALS.md "no special-case sentinels" rule). `char` reads as `u8`;
 * the canonical layer converts char-array fields to strings.
 */
const SCALAR_CODEC: Readonly<Record<string, string>> = {
    byte: "u8",
    char: "u8",
    word: "u16",
    dword: "u32",
    strref: "i32",
};

/** Resref is a fixed 8-byte name on wire; canonical layer trims to string. */
const RESREF_BYTES = 8;

function lookupCodec(type: string): string {
    const codec = SCALAR_CODEC[type];
    if (codec === undefined) {
        throw new Error(`Unhandled IESDP type: ${type}`);
    }
    return codec;
}

function arraySource(elementCodec: string, count: number): string {
    return `arraySpec({ element: { codec: ${elementCodec} }, count: ${count} })`;
}

export function translateField(item: OffsetItem): TranslatedField {
    const isUnused = item.unused !== undefined || item.unknown !== undefined;
    const name = isUnused ? "" : item.id !== undefined ? snakeToCamel(item.id) : descToCamelCase(item.desc);

    if (item.type === "resref") {
        return { name, fieldSource: arraySource("u8", RESREF_BYTES), imports: ["u8", "arraySpec"] };
    }

    // "char array" + length: a fixed-byte buffer (e.g. 4-byte signature).
    if (item.type === "char array") {
        if (item.length === undefined) {
            throw new Error(`'char array' requires explicit length: ${JSON.stringify(item)}`);
        }
        return { name, fieldSource: arraySource("u8", item.length), imports: ["u8", "arraySpec"] };
    }

    // `length` on non-char-array (rare): treat as raw byte buffer.
    if (item.length !== undefined) {
        return { name, fieldSource: arraySource("u8", item.length), imports: ["u8", "arraySpec"] };
    }

    if (item.mult !== undefined) {
        const codec = lookupCodec(item.type);
        return { name, fieldSource: arraySource(codec, item.mult), imports: [codec, "arraySpec"] };
    }

    const codec = lookupCodec(item.type);
    return { name, fieldSource: `{ codec: ${codec} }`, imports: [codec] };
}

/** Bytes consumed by one IESDP offset entry. */
const SCALAR_BYTES: Readonly<Record<string, number>> = {
    byte: 1,
    char: 1,
    word: 2,
    dword: 4,
    strref: 4,
};

function fieldByteSize(item: OffsetItem): number {
    if (item.length !== undefined) {
        return item.length;
    }
    if (item.type === "resref") {
        return RESREF_BYTES;
    }
    const base = SCALAR_BYTES[item.type];
    if (base === undefined) {
        throw new Error(`Cannot determine byte size for IESDP type: ${item.type}`);
    }
    return base * (item.mult ?? 1);
}

/**
 * Translates a list of IESDP offset items into a struct definition.
 *
 * Validates declared `offset` values against a running counter; throws on
 * mismatch (which signals upstream IESDP data is wrong, not user error).
 * Names unused/unknown fields `unused1..N` so the wire bytes round-trip
 * verbatim — they're padding from the parser's POV but real bytes on disk.
 */
export function translateStruct(items: readonly OffsetItem[]): TranslatedStruct {
    const fields: TranslatedField[] = [];
    const imports = new Set<string>();
    let offset = items[0]?.offset ?? 0;
    let unusedCount = 0;

    for (const item of items) {
        if (item.offset !== undefined && item.offset !== offset) {
            throw new Error(
                `Offset mismatch for ${JSON.stringify(item)}: ` +
                    `expected 0x${offset.toString(16)}, declared 0x${item.offset.toString(16)}`,
            );
        }

        const translated = translateField(item);
        const isUnused = item.unused !== undefined || item.unknown !== undefined;
        const finalField = isUnused ? { ...translated, name: `unused${++unusedCount}` } : translated;

        fields.push(finalField);
        for (const imp of finalField.imports) {
            imports.add(imp);
        }
        offset += fieldByteSize(item);
    }

    return { fields, imports };
}
