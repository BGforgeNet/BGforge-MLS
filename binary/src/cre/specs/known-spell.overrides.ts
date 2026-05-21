import type { FieldSpec } from "../../spec/types";
import { CreSpellType } from "../types";
import { creKnownSpellSpec } from "./known-spell";

export const creKnownSpellSpecAnnotated = {
    ...creKnownSpellSpec,
    spellType: { ...creKnownSpellSpec.spellType, enum: CreSpellType },
} satisfies Record<string, FieldSpec>;
