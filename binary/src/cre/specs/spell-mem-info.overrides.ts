import type { FieldSpec } from "../../spec/types";
import { CreSpellType } from "../types";
import { creSpellMemInfoSpec } from "./spell-mem-info";

export const creSpellMemInfoSpecAnnotated = {
    ...creSpellMemInfoSpec,
    spellType: { ...creSpellMemInfoSpec.spellType, enum: CreSpellType },
} satisfies Record<string, FieldSpec>;
