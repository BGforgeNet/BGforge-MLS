/**
 * Hand-written augmentation of the auto-generated `itmHeaderSpec` with
 * IESDP-derived enum / flag tables. The bare spec drives the codec; the
 * augmented spec adds presentation lookups consumed by walkStruct (display)
 * and `toZodSchema` strict-mode (canonical-write enum membership).
 *
 * Resref / signature / version fields are now `kind: "chars"` and surface as
 * strings; no annotation needed for those.
 */

import type { FieldSpec } from "../../spec/types";
import { ItmFlags, ItmType } from "../types";
import { itmHeaderSpec } from "./header";

export const itmHeaderSpecAnnotated = {
    ...itmHeaderSpec,
    flags: { ...itmHeaderSpec.flags, flags: ItmFlags },
    type: { ...itmHeaderSpec.type, enum: ItmType },
} satisfies Record<string, FieldSpec>;
