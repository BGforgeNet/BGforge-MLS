import type { FieldSpec } from "../../spec/types";
import { CreSpellType } from "../types";
import { creSpellMemInfoSpec } from "./spell-mem-info";

export const creSpellMemInfoSpecAnnotated = {
    ...creSpellMemInfoSpec,
    spellType: { ...creSpellMemInfoSpec.spellType, enum: CreSpellType },
    // This level's slice into the flat memorized-spells table - its start, a running offset over the preceding
    // levels' counts, and its own count. Owned by the memorization partition (CRE_MEMINFO_FIELDS in
    // cre/entity-ops.ts), which relinks them on every structure op, so `reserved` locks the editor input and
    // keeps the write-time recompute out of it - matching the ITM/SPL effect-range fields.
    firstMemorizedSpellIndex: { ...creSpellMemInfoSpec.firstMemorizedSpellIndex, role: "reserved" as const },
    memorizedSpellCount: { ...creSpellMemInfoSpec.memorizedSpellCount, role: "reserved" as const },
} satisfies Record<string, FieldSpec>;
