import { describe, expect, test } from "vitest";
import "../src"; // side-effect: register format adapters (presentation schemas live on the registry)
import { getFormatPresentationSchema } from "../src/presentation-schema";

/**
 * A record embedded by more than one format must present identically everywhere - same enum/flag tables, same
 * `numericFormat`, same labels. The spec is already shared (one `StructSpec`); this guards the other half, the
 * presentation, which is passed positionally at each `walkStruct` / `toPresentationEntries` site and so can
 * silently drift if one site re-declares an empty `{}` instead of importing the record's shared presentation.
 * Both drifts have happened: the EFF v2 body's `stackingIdTobex` hex was wired at the standalone-EFF site but
 * not the CRE-embedded one, and the v1 feature block carried five independent `{}` literals. This test fails
 * if any embedding site stops sharing the canonical presentation object.
 *
 * Each entry's `exactFields` keys are `<prefix>.<field-slug>`; comparing the per-format suffix->entry maps
 * factors out the prefix so only the record's own presentation is compared.
 */
function suffixEntries(format: string, prefix: string): Record<string, unknown> {
    const schema = getFormatPresentationSchema(format);
    if (!schema) throw new Error(`no presentation schema for format ${format}`);
    const out: Record<string, unknown> = {};
    const dotted = `${prefix}.`;
    for (const [key, entry] of Object.entries(schema.exactFields)) {
        if (key.startsWith(dotted)) {
            out[key.slice(dotted.length)] = entry;
        }
    }
    return out;
}

describe("shared record presentation is identical across embedding formats", () => {
    test("feature block / EFF v1 record renders identically in ITM, SPL, and CRE-v0", () => {
        const itm = suffixEntries("itm", "itm.effects[]");
        const spl = suffixEntries("spl", "spl.effects[]");
        const creV1 = suffixEntries("cre", "cre.effects[].v1");
        // Non-empty so the comparison has teeth: opcode/target/timing enums + resistance/saveType flags.
        expect(Object.keys(itm).length).toBeGreaterThan(0);
        expect(spl).toEqual(itm);
        expect(creV1).toEqual(itm);
    });

    test("EFF v2 body renders identically in standalone EFF and CRE-v2", () => {
        const eff = suffixEntries("eff", "eff.body");
        const creV2 = suffixEntries("cre", "cre.effects[].v2");
        expect(Object.keys(eff).length).toBeGreaterThan(0);
        // The packed stacking id is the field that previously drifted - assert its hex format explicitly as
        // well. `toMatchObject` so the guard stays on the shared `numericFormat` and does not couple to the
        // IESDP-sourced `description`/`docUrl` the field also now carries (those would churn on a docs resync);
        // the full cross-format identity is pinned by the `toEqual(eff)` below regardless.
        expect(eff.stackingIdTobex).toMatchObject({ numericFormat: "hex32" });
        expect(creV2).toEqual(eff);
    });
});
