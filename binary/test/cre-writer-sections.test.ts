/**
 * CRE writer: section layout, offset repair, and the size guard.
 *
 * These cover what the other CRE suites structurally cannot. `cre-rebuild.test.ts` builds its documents with
 * `buildMinimalCreDoc`, whose own docstring says every section is empty except a single effect record - so
 * every `offset + i * RECORD_SIZE` in the writer multiplies by zero, and a wrong stride, a wrong record size,
 * or a loop that never runs produces identical bytes. Mutation testing put numbers on it: the CRE writer
 * scored 37% with 21 mutants no test reached at all, the lowest of the byte-critical writers.
 *
 * So the first test below is deliberately PLURAL - two or more records in every section, each carrying a
 * distinct value - because that is the only shape in which a stride can be observed. The other two cover the
 * two guards in the writer that no fixture reaches: the repair of an out-of-bounds preserved offset, and the
 * refusal to allocate past the format's size envelope.
 */

import { describe, expect, it } from "vitest";
import { creParser } from "../src/cre";
import { serializeCreCanonicalDocument } from "../src/cre/canonical-writer";
import { creCanonicalDocumentSchemaPermissive, type CreCanonicalDocument } from "../src/cre/canonical-schemas";
import { creHeaderSpecAnnotated } from "../src/cre/specs/header.overrides";
import { creItemSpecAnnotated } from "../src/cre/specs/item.overrides";
import { creKnownSpellSpecAnnotated } from "../src/cre/specs/known-spell.overrides";
import { creMemorizedSpellSpecAnnotated } from "../src/cre/specs/memorized-spell.overrides";
import { creSpellMemInfoSpecAnnotated } from "../src/cre/specs/spell-mem-info.overrides";
import { effectSpecAnnotated } from "../src/ie-common/specs/effect.overrides";
import { effBodySpecAnnotated } from "../src/eff/specs/body.overrides";
import { EFF_SIGNATURE, EFF_VERSION_V2 } from "../src/eff/types";
import {
    CRE_SIGNATURE,
    CRE_VERSION_V1,
    CRE_ITEM_SLOT_COUNT,
    CRE_HEADER_SIZE,
    CRE_ITEM_SIZE,
    CRE_ITEM_SLOTS_SIZE,
} from "../src/cre/types";
import { MAX_FILE_SIZES } from "../src/max-file-sizes";
import { isArraySpec, isCharsSpec, type FieldSpec } from "../src/spec/types";
import { parseWithSchemaValidation } from "../src/schema-validation";

/** All-zero record for a spec (chars -> "", scalars/flags -> 0/[], arrays -> 0[n]). */
function zeroRecord(spec: Record<string, FieldSpec>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(spec)) {
        const fs = spec[key]!;
        if (isCharsSpec(fs)) out[key] = "";
        else if (isArraySpec(fs))
            out[key] = Array.from({ length: typeof fs.count === "number" ? fs.count : 0 }, () => 0);
        else if (fs.flags) out[key] = [] as string[];
        else out[key] = 0;
    }
    return out;
}

function zeroEffV2(): Record<string, unknown> {
    const body = zeroRecord(effBodySpecAnnotated);
    body["signature2"] = String.fromCodePoint(...EFF_SIGNATURE);
    body["version2"] = String.fromCodePoint(...EFF_VERSION_V2);
    return body;
}

/**
 * `n` records of a spec, each with `field` set to a value derived from its index, so position is observable.
 * The value factory is a parameter because the distinguishing field is not a number in every record type -
 * a memorized spell's only non-flag field is its resref.
 */
function numbered(
    spec: Record<string, FieldSpec>,
    field: string,
    n: number,
    value: (i: number) => unknown = (i) => i + 1,
): Record<string, unknown>[] {
    return Array.from({ length: n }, (_, i) => ({ ...zeroRecord(spec), [field]: value(i) }));
}

/**
 * Distinct resrefs for the sections whose only writable field is a resource name. Exactly 8 characters, the
 * full field width: a shorter name comes back NUL-padded to the field, and asserting on that padding would
 * pin an encoding detail this test is not about.
 */
const RESREFS = ["SPLONE01", "SPLTWO02", "SPLTRI03"] as const;

/**
 * The CRE canonical document behind a parse result.
 *
 * `ParseResult.document` is the cross-format `BinaryCanonicalDocument` union, so reaching CRE's member needs
 * an assertion; the narrowing that makes it safe is the assertion above every call - `parsed.errors` is
 * undefined and the bytes came from `creParser`, so the union member is CRE's by construction. Isolated here
 * rather than repeated at each call site, per the guidance on lifting a repeated cast into one helper.
 */
function creDocOf(parsed: { document?: unknown }): CreCanonicalDocument {
    return parsed.document as CreCanonicalDocument;
}

function header(effectKind: "v1" | "v2"): Record<string, unknown> {
    const h = zeroRecord(creHeaderSpecAnnotated);
    h["signature"] = String.fromCodePoint(...CRE_SIGNATURE);
    h["version"] = String.fromCodePoint(...CRE_VERSION_V1);
    h["effStructureVersion"] = effectKind === "v1" ? 0 : 1;
    return h;
}

/**
 * Item slots cycle through -1 (empty) and the three real item indices rather than repeating one value: a
 * uniform block round-trips byte-identically under a wrong stride, which is exactly how the existing
 * all-`-1` fixture let the slot loop's mutants live.
 */
const ITEM_COUNT = 3;
const itemSlots = (): number[] => Array.from({ length: CRE_ITEM_SLOT_COUNT }, (_, i) => (i % (ITEM_COUNT + 1)) - 1);

function pluralDoc(effectKind: "v1" | "v2"): CreCanonicalDocument {
    const effectSpec = effectKind === "v1" ? effectSpecAnnotated : effBodySpecAnnotated;
    const records =
        effectKind === "v1"
            ? numbered(effectSpec as Record<string, FieldSpec>, "opcode", 3)
            : numbered(effectSpec as Record<string, FieldSpec>, "opcode", 3).map((r) => ({ ...zeroEffV2(), ...r }));
    const raw = {
        header: header(effectKind),
        knownSpells: numbered(creKnownSpellSpecAnnotated as Record<string, FieldSpec>, "spellLevel", 3),
        spellMemInfo: numbered(creSpellMemInfoSpecAnnotated as Record<string, FieldSpec>, "numMemorizable", 3),
        memorizedSpells: numbered(
            creMemorizedSpellSpecAnnotated as Record<string, FieldSpec>,
            "spell",
            3,
            (i) => RESREFS[i]!,
        ),
        effects: { kind: effectKind, records },
        items: numbered(creItemSpecAnnotated as Record<string, FieldSpec>, "quantity1", ITEM_COUNT),
        itemSlots: itemSlots(),
    };
    return parseWithSchemaValidation(creCanonicalDocumentSchemaPermissive, raw, `plural CRE ${effectKind} doc`);
}

describe("CRE writer - every section round-trips at its own stride", () => {
    for (const kind of ["v1", "v2"] as const) {
        it(`${kind} effects: three records per section come back in order and at the right index`, () => {
            const doc = pluralDoc(kind);
            const parsed = creParser.parse(new Uint8Array(serializeCreCanonicalDocument(doc)));
            expect(parsed.errors).toBeUndefined();

            const back = creDocOf(parsed);

            // Each assertion is per-INDEX, so a stride that is wrong by any amount - a different record size,
            // a subtraction, a division, a loop that stops early - lands the wrong value here rather than
            // producing an equal-looking blob.
            expect(back.knownSpells.map((r) => (r as { spellLevel: number }).spellLevel)).toEqual([1, 2, 3]);
            expect(back.spellMemInfo.map((r) => (r as { numMemorizable: number }).numMemorizable)).toEqual([1, 2, 3]);
            expect(back.memorizedSpells.map((r) => (r as { spell: string }).spell)).toEqual([...RESREFS]);
            expect(back.effects.kind).toBe(kind);
            expect(back.effects.records.map((r) => (r as { opcode: number }).opcode)).toEqual([1, 2, 3]);
            expect(back.items.map((r) => (r as { quantity1: number }).quantity1)).toEqual([1, 2, 3]);
            expect([...back.itemSlots]).toEqual(itemSlots());
        });
    }

    it("v1 and v2 effect records are written at their own record size, not each other's", () => {
        // The effect stride is the one the single-record fixture could never see: with one record the index
        // multiplier is zero, so v1's 0x30 and v2's 0x108 produce the same bytes. With three, using the wrong
        // size overlaps or scatters them, and the total file size differs too.
        const v1 = serializeCreCanonicalDocument(pluralDoc("v1"));
        const v2 = serializeCreCanonicalDocument(pluralDoc("v2"));
        expect(v2.length).toBeGreaterThan(v1.length);

        for (const [kind, bytes] of [
            ["v1", v1],
            ["v2", v2],
        ] as const) {
            const parsed = creParser.parse(new Uint8Array(bytes));
            expect(parsed.errors, `${kind} reparse`).toBeUndefined();
            const back = creDocOf(parsed);
            expect(
                back.effects.records.map((r) => (r as { opcode: number }).opcode),
                `${kind} opcodes`,
            ).toEqual([1, 2, 3]);
        }
    });
});

describe("CRE writer - an empty section's preserved offset is repaired when it falls outside the file", () => {
    it("rewrites a stored offset that points past the end, leaving the file parseable", () => {
        // An empty section keeps whatever offset the header stored, so a byte-exact no-op round-trip is
        // possible for fixtures that park a stale value there. But a document whose sections shrank can leave
        // that preserved offset beyond the new EOF, and the parser rejects `offset > size` even for a
        // zero-length section - so the writer falls back to the computed in-bounds position.
        const doc = pluralDoc("v1");
        const shrunk = parseWithSchemaValidation(
            creCanonicalDocumentSchemaPermissive,
            {
                ...doc,
                // Empty, so nonEmptyCreSectionOffsets omits it and enforceDerivedFields preserves the stored
                // value verbatim - which is the only way this offset survives to be out of bounds.
                memorizedSpells: [],
                header: { ...doc.header, memorizedSpellsOffset: 0xffff },
            },
            "CRE doc with an out-of-bounds preserved offset",
        );

        const bytes = serializeCreCanonicalDocument(shrunk);
        expect(0xffff).toBeGreaterThan(bytes.length); // the stored offset really is past the end

        const parsed = creParser.parse(new Uint8Array(bytes));
        expect(parsed.errors).toBeUndefined();
        const back = creDocOf(parsed);
        expect((back.header as { memorizedSpellsOffset: number }).memorizedSpellsOffset).toBeLessThanOrEqual(
            bytes.length,
        );
    });

    it("keeps an offset sitting exactly at the end of the file", () => {
        // The repair triggers on `> totalSize`, not `>=`. An offset equal to the file length is in bounds -
        // the parser rejects only `offset > size` - so a zero-length section parked at EOF is legal and must
        // survive untouched. Serializing once is how the length becomes knowable to aim at.
        const doc = pluralDoc("v1");
        const emptied = (offset: number) =>
            parseWithSchemaValidation(
                creCanonicalDocumentSchemaPermissive,
                { ...doc, memorizedSpells: [], header: { ...doc.header, memorizedSpellsOffset: offset } },
                "CRE doc with a preserved offset at EOF",
            );

        const length = serializeCreCanonicalDocument(emptied(0x20)).length;
        const bytes = serializeCreCanonicalDocument(emptied(length));

        const parsed = creParser.parse(new Uint8Array(bytes));
        expect(parsed.errors).toBeUndefined();
        expect((creDocOf(parsed).header as { memorizedSpellsOffset: number }).memorizedSpellsOffset).toBe(length);
    });

    it("leaves a preserved offset alone when it is still inside the file", () => {
        // The other half of the branch: only an OUT-OF-BOUNDS offset is rewritten. A stale but in-bounds value
        // is what keeps a real fixture byte-exact through a no-op round-trip, so it must survive untouched.
        const doc = pluralDoc("v1");
        const stored = 0x20;
        const kept = parseWithSchemaValidation(
            creCanonicalDocumentSchemaPermissive,
            { ...doc, memorizedSpells: [], header: { ...doc.header, memorizedSpellsOffset: stored } },
            "CRE doc with an in-bounds preserved offset",
        );

        const bytes = serializeCreCanonicalDocument(kept);
        expect(bytes.length).toBeGreaterThan(stored);

        const parsed = creParser.parse(new Uint8Array(bytes));
        expect(parsed.errors).toBeUndefined();
        const back = creDocOf(parsed);
        expect((back.header as { memorizedSpellsOffset: number }).memorizedSpellsOffset).toBe(stored);
    });
});

describe("CRE writer - refuses to allocate past the format's size envelope", () => {
    it("throws before allocating, naming the section counts and the budget", () => {
        // Sparse arrays: the guard runs before any element is read, and the offset computation only reads
        // `.length`, so this reaches the check without building a quarter-megabyte of records.
        const budget = MAX_FILE_SIZES.cre!;
        const doc = pluralDoc("v1");
        // Deliberately not a valid document: a bare `length` with no elements, which is the point - the
        // guard must refuse on the projected size before anything reads an element. A schema-valid document
        // of this size would have to allocate the quarter megabyte the test exists to prove is refused.
        const oversized = {
            ...doc,
            items: { length: Math.ceil(budget / 0x14) + 1 },
        } as unknown as CreCanonicalDocument;

        // The message must name EVERY section's count, not just the projected total. When a document blows
        // the envelope the useful question is which section did it, and a message that drops four of the five
        // cannot answer that - the diagnostic is the whole reason this throws instead of allocating.
        expect(() => serializeCreCanonicalDocument(oversized)).toThrow(
            new RegExp(
                [
                    "cre snapshot would expand to \\d+ bytes",
                    "knownSpells: \\d+",
                    "spellMemInfo: \\d+",
                    "memorizedSpells: \\d+",
                    "effects: \\d+",
                    `items: ${oversized.items.length}`,
                    `${budget} byte budget`,
                ].join(".*"),
            ),
        );
    });

    it("allows a document that lands exactly on the budget", () => {
        // The boundary is `> budget`, not `>=`: a file filling the envelope exactly is legal and must not be
        // refused. Every other section is empty so the total is header + items + the fixed slot block, which
        // is the one arrangement that reaches the budget without remainder - the leftover divides by the item
        // size exactly. Real records here, not the sparse array above: this document is serialized, so every
        // element is read.
        const budget = MAX_FILE_SIZES.cre!;
        const count = (budget - CRE_HEADER_SIZE - CRE_ITEM_SLOTS_SIZE) / CRE_ITEM_SIZE;
        expect(Number.isInteger(count), "budget must be reachable to the byte").toBe(true);

        const item = zeroRecord(creItemSpecAnnotated as Record<string, FieldSpec>);
        const atBudget = (n: number) =>
            ({
                header: header("v1"),
                knownSpells: [],
                spellMemInfo: [],
                memorizedSpells: [],
                effects: { kind: "v1", records: [] },
                // One record object shared across every slot - the writer only reads it, and building 13k
                // distinct copies would cost the test seconds for nothing.
                items: Array.from({ length: n }, () => item),
                itemSlots: Array.from({ length: CRE_ITEM_SLOT_COUNT }, () => -1),
            }) as unknown as CreCanonicalDocument;

        expect(serializeCreCanonicalDocument(atBudget(count))).toHaveLength(budget);
        // One more item tips it over, which is what makes the line above a boundary rather than a point
        // comfortably inside the envelope.
        expect(() => serializeCreCanonicalDocument(atBudget(count + 1))).toThrow(/refusing to allocate/);
    });
});
