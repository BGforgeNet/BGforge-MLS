import { describe, expect, test } from "vitest";
import { crePresentationSchema } from "../src/cre/presentation-schema";

describe("CRE derived (structural) fields are locked from editing", () => {
    const entries = crePresentationSchema.exactFields;

    // The memorization-info range fields are the CRE half of the effect/spell partition cohort
    // (CRE_MEMINFO_FIELDS): the partition owns them, so the editor must not offer them for hand-editing -
    // same contract the ITM/SPL range fields carry in their own guards.
    test.each(["cre.spellMemInfo[].firstMemorizedSpellIndex", "cre.spellMemInfo[].memorizedSpellCount"])(
        "%s carries editable: false",
        (key) => {
            expect(entries[key]).toMatchObject({ editable: false });
        },
    );
});
