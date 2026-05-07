/**
 * Hand-written augmentation of the auto-generated `itmHeaderSpec` with
 * IESDP-derived enum / flag tables. The bare spec drives the codec; the
 * augmented spec adds presentation lookups consumed by walkStruct (display)
 * and `toZodSchema` strict-mode (canonical-write enum membership).
 *
 * Resref / signature / version fields are now `kind: "chars"` and surface as
 * strings; no annotation needed for those.
 */

import { arraySpec, type FieldSpec } from "../../spec/types";
import { u8 } from "typed-binary";
import {
    ItmFlags,
    ItmType,
    ItmUsabilityByte1Flags,
    ItmUsabilityByte2Flags,
    ItmUsabilityByte3Flags,
    ItmUsabilityByte4Flags,
} from "../types";
import { itmHeaderSpec } from "./header";

export const itmHeaderSpecAnnotated = {
    ...itmHeaderSpec,
    flags: { ...itmHeaderSpec.flags, flags: ItmFlags },
    // ItmType is backed by `itemtype.2da` which mods can extend with custom
    // item categories; the engine accepts any 16-bit value. Display lookup
    // only — strict canonical mode does not reject unrecognised types.
    type: { ...itmHeaderSpec.type, enum: ItmType, enumOpen: true },
    // Usability flags is a 4-byte block where each byte carries a distinct
    // flag table per IESDP. Slots view with per-slot element overrides
    // surfaces 4 flag rows in the editor; canonical doc shape stays as
    // number[] so JSON snapshots and round-trip are unaffected.
    usabilityFlags: arraySpec({
        element: { codec: u8 },
        count: 4,
        view: "slots",
        slotLabels: ["Byte 1 (Class / Alignment)", "Byte 2 (Class)", "Byte 3 (Class / Race)", "Byte 4 (Race)"],
        slotElements: [
            { codec: u8, flags: ItmUsabilityByte1Flags },
            { codec: u8, flags: ItmUsabilityByte2Flags },
            { codec: u8, flags: ItmUsabilityByte3Flags },
            { codec: u8, flags: ItmUsabilityByte4Flags },
        ],
    }),
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
