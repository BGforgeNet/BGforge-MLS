import { describe, expect, test } from "vitest";
import "../src"; // side-effect: register all parsers and adapters
import { loadBinaryJsonSnapshot } from "../src/json-snapshot";
import { splParser } from "../src/spl";
import { createCanonicalSplJsonSnapshot } from "../src/spl/json-snapshot";
import { defaultSplAbility } from "../src/spl/entity-ops";
import { splHeaderSpecAnnotated } from "../src/spl/specs/header.overrides";
import { SPL_ABILITY_SIZE, SPL_HEADER_SIZE } from "../src/spl/types";
import { enforceDerivedFields } from "../src/spec/types";

/**
 * Forge a minimal-but-valid, zero-ability/zero-effect SPL v1 header so a
 * real canonical snapshot (header only, from the real parser) can be used
 * as the base for inflating one array field - mirrors the forgeSplHeader
 * helper in itm-spl-snapshot.test.ts.
 */
function forgeEmptySplHeader(): Uint8Array {
    const bytes = new Uint8Array(0x72);
    bytes.set([0x53, 0x50, 0x4c, 0x20], 0); // "SPL "
    bytes.set([0x56, 0x31, 0x20, 0x20], 4); // "V1  "
    const dv = new DataView(bytes.buffer);
    dv.setUint32(0x64, 0x72, true); // extendedHeadersOffset
    dv.setUint16(0x68, 0, true); // extendedHeadersCount
    dv.setUint32(0x6a, 0x72, true); // featureBlocksOffset
    return bytes;
}

// NUL-padded 8-byte placeholder for the ability's memorisedIcon chars(8) field. Re-parsing
// serialized bytes always decodes an empty chars field as this NUL-padded string (never ""),
// so building it this way avoids an unrelated semantic-round-trip mismatch (defaultSplAbility()
// uses "" as its canonical zero value, which is correct for the live editor's "add ability"
// action but does not equal what a byte-level reparse yields).
const NUL_ICON = String.fromCodePoint(0).repeat(8);

/**
 * Builds a valid SPL canonical snapshot JS object with `abilityCount` abilities (each a
 * clone of `defaultSplAbility()`) and zero effects. The header's derived fields
 * (`extendedHeadersCount`/`extendedHeadersOffset`/`featureBlocksOffset`) are recomputed via
 * `enforceDerivedFields` - the same helper the real writer uses - so the snapshot is
 * internally consistent and would only be rejected by the writer's new size-bound check,
 * not by the pre-existing structural/semantic round-trip validation.
 */
function splSnapshotDocWithAbilities(abilityCount: number): Record<string, unknown> {
    const result = splParser.parse(forgeEmptySplHeader());
    if (result.errors) throw new Error(`forged SPL header failed to parse: ${result.errors.join(", ")}`);
    const json = createCanonicalSplJsonSnapshot(result);
    const doc = JSON.parse(json) as { document: { header: Record<string, unknown>; effects: unknown[] } } & Record<
        string,
        unknown
    >;

    const abilities = Array.from({ length: abilityCount }, () => ({
        ...defaultSplAbility(),
        memorisedIcon: NUL_ICON,
    }));
    const abilitiesOffset = SPL_HEADER_SIZE;
    const effectsOffset = abilitiesOffset + abilities.length * SPL_ABILITY_SIZE;
    const header = enforceDerivedFields(splHeaderSpecAnnotated, doc.document.header, {
        arrays: { abilities },
        sectionOffsets: { abilities: abilitiesOffset, effects: effectsOffset },
    });

    return { ...doc, document: { ...doc.document, header, abilities, effects: [] } };
}

// One ability short of what the SPL budget (256 KiB, see max-file-sizes.ts) can hold, and
// comfortably past it - abilitiesOffset (SPL_HEADER_SIZE) + N * SPL_ABILITY_SIZE must exceed
// the budget for the writer's totalSize computation to trip.
const SPL_BUDGET_BYTES = 256 * 1024;
const OVERSIZE_ABILITY_COUNT = Math.ceil((SPL_BUDGET_BYTES - SPL_HEADER_SIZE) / SPL_ABILITY_SIZE) + 200;

describe("loadBinaryJsonSnapshot - snapshot expansion size bound", () => {
    test("rejects a SPL snapshot whose declared abilities array would expand past the format budget", () => {
        const jsonText = JSON.stringify(splSnapshotDocWithAbilities(OVERSIZE_ABILITY_COUNT));

        expect(() => loadBinaryJsonSnapshot(jsonText)).toThrow(
            /spl snapshot would expand to \d+ bytes .*exceeding the format's 262144 byte budget/,
        );
    });

    test("a normal-size SPL snapshot still loads (no false positive on legitimate input)", () => {
        const jsonText = JSON.stringify(splSnapshotDocWithAbilities(3));

        const loaded = loadBinaryJsonSnapshot(jsonText);
        expect(loaded.parseResult.format).toBe("spl");
    });
});
