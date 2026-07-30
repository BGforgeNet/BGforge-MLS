import type { OffsetItem } from "../../ie-update/src/ie/types.ts";
import { applySignedness } from "./signed-fields.ts";

export interface TranslatedField {
    readonly name: string;
    readonly fieldSource: string;
    /** Identifiers the emitted source depends on - typed-binary codecs, spec helpers. */
    readonly imports: ReadonlyArray<string>;
    /** Cleaned IESDP `desc`, surfaced as an editor tooltip (presentation only). Undefined for unused bytes. */
    readonly description?: string;
    /** Link to the field's full IESDP documentation, emitted when the tooltip was capped (more to read). */
    readonly docUrl?: string;
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
    cleaned = cleaned.replaceAll(/\[([^\]]+)\]\([^)]+\)/g, "$1");

    // Repeat-until-stable strip - handles nested tags like `<a<b>>` that a
    // single greedy pass would leave residue from.
    let prev: string;
    do {
        prev = cleaned;
        cleaned = cleaned.replaceAll(/<[^<>]*>/g, "");
    } while (cleaned !== prev);

    cleaned = cleaned.replaceAll(/\([^)]*\)/g, "");
    return camelCaseWords(cleaned.trim().split(/\s+/).filter(Boolean), desc);
}

/**
 * Cleans an IESDP `desc` into readable tooltip prose. Unlike `descToCamelCase` (which strips aggressively to
 * derive an identifier), this preserves the wording - only the source-markup a tooltip cannot render is
 * removed: Jekyll/Liquid directives (`{% include %}`, `{% capture %}`; the prose BETWEEN capture/endcapture is
 * kept, only the tags go), Markdown link syntax (link text kept), and HTML tags (`<b>`, `<a name>`, `<br>`,
 * `<code>`). Whitespace - including the newlines of a YAML block scalar - collapses to single spaces. The
 * result is verbatim wording, not a summary (the caller chose "cleaned text", not "summarize").
 */
export function cleanDescription(desc: string): string {
    let s = desc;
    s = s.replaceAll(/\{%[^%]*%\}/g, " ");
    s = s.replaceAll(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    let prev: string;
    do {
        prev = s;
        s = s.replaceAll(/<[^<>]*>/g, " ");
    } while (s !== prev);
    // IESDP prose is full of typographic Unicode (long arrows in enum-value lists, en/em dashes, smart quotes).
    // Fold to ASCII - the generated file, like every authored artifact here, is plain ASCII.
    s = s
        .replaceAll(/[\u2192\u27F6\u2794\u2799\u279C]/g, "->")
        .replaceAll(/[\u2190\u27F5]/g, "<-")
        .replaceAll(/[\u2010\u2011\u2012\u2013\u2014]/g, "-")
        .replaceAll(/[\u2018\u2019\u201A\u201B]/g, "'")
        .replaceAll(/[\u201C\u201D\u201E\u201F]/g, '"')
        .replaceAll("\u2026", "...")
        .replaceAll("\u00D7", "x")
        .replaceAll("\u2265", ">=")
        .replaceAll("\u2264", "<=")
        .replaceAll("\u2260", "!=")
        .replaceAll("\u00A0", " ");
    return s.replaceAll(/\s+/g, " ").trim();
}

/** Longest tooltip surfaced inline; a longer description is cut here and a "full docs" link is emitted. */
const TOOLTIP_CAP = 200;

/**
 * Cap a cleaned description for an inline hover tooltip. A short desc passes through whole; a long one (a full
 * IESDP field write-up - e.g. an enum field documenting every value's behaviour) is cut at the first sentence
 * end before the cap when there is one, else at the last word boundary, and marked truncated so the caller can
 * link to the full text. IESDP enum lists separate values with " - " (not ". "), so the first sentence break
 * lands after the value enumeration - the useful part stays, the verbose per-value prose goes behind the link.
 */
export function capTooltip(cleaned: string): { text: string; truncated: boolean } {
    if (cleaned.length <= TOOLTIP_CAP) return { text: cleaned, truncated: false };
    const sentenceEnd = cleaned.indexOf(". ");
    if (sentenceEnd !== -1 && sentenceEnd < TOOLTIP_CAP) {
        return { text: cleaned.slice(0, sentenceEnd + 1), truncated: true };
    }
    const slice = cleaned.slice(0, TOOLTIP_CAP);
    const lastSpace = slice.lastIndexOf(" ");
    const cut = lastSpace > TOOLTIP_CAP / 2 ? slice.slice(0, lastSpace) : slice;
    return { text: `${cut} ...`, truncated: true };
}

/**
 * IESDP scalar type -> typed-binary codec name.
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

/** IESDP has no signed integer type, so a semantically signed field is corrected from its curated list. */
function signedCodec(specConst: string | undefined, fieldName: string, codec: string): string {
    return specConst === undefined ? codec : applySignedness(specConst, fieldName, codec);
}

function arraySource(elementCodec: string, count: number): string {
    return `arraySpec({ element: { codec: ${elementCodec} }, count: ${count} })`;
}

export function translateField(item: OffsetItem, docBaseUrl?: string, specConst?: string): TranslatedField {
    const isUnused = item.unused !== undefined || item.unknown !== undefined;
    const name = isUnused ? "" : item.id !== undefined ? snakeToCamel(item.id) : descToCamelCase(item.desc);

    // resref / char array -> first-class chars primitive. The wire footprint
    // stays N raw bytes; the data layer surfaces a NUL-stripped string. Used
    // by IESDP for fixed-size name / signature / version fields.
    if (item.type === "resref") {
        return { name, fieldSource: `charsSpec(${RESREF_BYTES})`, imports: ["charsSpec"] };
    }

    if (item.type === "char array") {
        if (item.length === undefined) {
            throw new Error(`'char array' requires explicit length: ${JSON.stringify(item)}`);
        }
        return { name, fieldSource: `charsSpec(${item.length})`, imports: ["charsSpec"] };
    }

    // `length` on non-char-array (rare): treat as raw byte buffer.
    if (item.length !== undefined) {
        return { name, fieldSource: arraySource("u8", item.length), imports: ["u8", "arraySpec"] };
    }

    if (item.mult !== undefined) {
        const codec = signedCodec(specConst, name, lookupCodec(item.type));
        return { name, fieldSource: arraySource(codec, item.mult), imports: [codec, "arraySpec"] };
    }

    const codec = signedCodec(specConst, name, lookupCodec(item.type));
    // Scalars are the only spec form that carries tooltip metadata in this pass: the `{ codec }` object literal
    // has slots for it, whereas `charsSpec()` / `arraySpec()` (resref, string, byte-run fields) do not - left
    // for a follow-up. Emit the CAPPED desc plus, when the full write-up is longer, a link to the field's IESDP
    // page so the tooltip stays short. The presentation layer (derive-presentation) decides whether the desc
    // adds anything over the label before surfacing either.
    const cleaned = isUnused || !item.desc ? undefined : cleanDescription(item.desc) || undefined;
    const capped = cleaned ? capTooltip(cleaned) : undefined;
    // Link to the field's IESDP format page when the tooltip was capped (there is more to read). Page-level,
    // NOT field-precise: IESDP's per-field `<a name="itmv1_..._0xNN">` anchors are referenced in prose but not
    // emitted as anchor definitions on the published page (verified dead), so a fragment would land nowhere -
    // the page itself is the only reliable target.
    const docUrl = docBaseUrl !== undefined && capped?.truncated === true ? docBaseUrl : undefined;
    const parts = [`codec: ${codec}`];
    // IESDP's `strref` collapses to a plain i32 on the wire, so carry the distinction as a spec property -
    // otherwise the only trace is the word "(strref)" inside some (not all) descriptions, which no consumer
    // can key off. It survives on `unused` entries too: those are strrefs the engine ignores, not non-strrefs.
    if (item.type === "strref") parts.push('ref: { kind: "strref" }');
    if (capped) parts.push(`description: ${JSON.stringify(capped.text)}`);
    if (docUrl !== undefined) parts.push(`docUrl: ${JSON.stringify(docUrl)}`);
    return {
        name,
        fieldSource: `{ ${parts.join(", ")} }`,
        imports: [codec],
        ...(capped && { description: capped.text }),
        ...(docUrl !== undefined && { docUrl }),
    };
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
 * verbatim - they're padding from the parser's POV but real bytes on disk.
 */
export function translateStruct(
    items: readonly OffsetItem[],
    docBaseUrl?: string,
    specConst?: string,
): TranslatedStruct {
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

        const translated = translateField(item, docBaseUrl, specConst);
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
