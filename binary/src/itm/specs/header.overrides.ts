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
    // ItmType is backed by `itemtype.2da` which mods can extend with custom
    // item categories; the engine accepts any 16-bit value. Display lookup
    // only — strict canonical mode does not reject unrecognised types.
    type: { ...itmHeaderSpec.type, enum: ItmType, enumOpen: true },
    // Structural pointers into the abilities + effects sections that follow
    // the header. Editing these by hand silently corrupts the file, so the
    // editor renders them as read-only and (eventually) the canonical writer
    // recomputes them from the doc shape. See `FieldRole` in spec/types.
    extendedHeadersOffset: {
        ...itmHeaderSpec.extendedHeadersOffset,
        role: "derivedOffset" as const,
        derivedFrom: { section: "abilities" } as const,
    },
    extendedHeadersCount: {
        ...itmHeaderSpec.extendedHeadersCount,
        role: "derivedCount" as const,
        derivedFrom: { array: "abilities" } as const,
    },
    featureBlocksOffset: {
        ...itmHeaderSpec.featureBlocksOffset,
        role: "derivedOffset" as const,
        derivedFrom: { section: "effects" } as const,
    },
    // featureBlocksIndex partitions effects between equipped (global) and
    // ability-triggered subsets — see IESDP. The split is decided at the
    // canonical-doc level, not by a single sibling array's length, but the
    // value remains derived rather than user data; the writer is responsible
    // for emitting it correctly. Locking the editor input is still right.
    featureBlocksIndex: {
        ...itmHeaderSpec.featureBlocksIndex,
        role: "derivedIndex" as const,
        derivedFrom: { table: "effects" } as const,
    },
    featureBlocksCount: {
        ...itmHeaderSpec.featureBlocksCount,
        role: "derivedCount" as const,
        derivedFrom: { array: "effects" } as const,
    },
} satisfies Record<string, FieldSpec>;
