import type { FieldSpec } from "../../spec/types";
import { CreMemorizedSpellFlags } from "../types";
import { creMemorizedSpellSpec } from "./memorized-spell";

export const creMemorizedSpellSpecAnnotated = {
    ...creMemorizedSpellSpec,
    memorizedFlags: { ...creMemorizedSpellSpec.memorizedFlags, flags: CreMemorizedSpellFlags },
} satisfies Record<string, FieldSpec>;
