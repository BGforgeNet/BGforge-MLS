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
    ItmKitUsabilityByte1Flags,
    ItmKitUsabilityByte2Flags,
    ItmKitUsabilityByte3Flags,
    ItmKitUsabilityByte4Flags,
    ItmType,
    ItmWeaponProficiency,
    ItmUsabilityByte1Flags,
    ItmUsabilityByte2Flags,
    ItmUsabilityByte3Flags,
    ItmUsabilityByte4Flags,
} from "../types";
import { itmHeaderSpec } from "./header";

export const itmHeaderSpecAnnotated = {
    ...itmHeaderSpec,
    /**
     * Resref targets are hand-declared: IESDP records them only in prose and inconsistently (this ground icon
     * reads "Ground icon (BAM)" here but plain "Ground icon" in SPL). This one is a replacement ITEM except in
     * PSTEE, whose v1.0 items store a drop SOUND here. The other game storing a sound is PST classic, but its
     * items are v1.1 and this parser rejects those, so no `pst` entry is needed.
     */
    replacement: {
        ...itmHeaderSpec.replacement,
        ref: { kind: "resource", type: "ITM", byFlavour: { pstee: "WAV" } },
    },
    inventoryIcon: { ...itmHeaderSpec.inventoryIcon, ref: { kind: "resource", type: "BAM" } },
    groundIcon: { ...itmHeaderSpec.groundIcon, ref: { kind: "resource", type: "BAM" } },
    descriptionIcon: { ...itmHeaderSpec.descriptionIcon, ref: { kind: "resource", type: "BAM" } },
    flags: { ...itmHeaderSpec.flags, flags: ItmFlags },
    // ItmType is backed by `itemtype.2da` which mods can extend with custom
    // item categories; the engine accepts any 16-bit value. Display lookup
    // only - strict canonical mode does not reject unrecognised types.
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
    // The four kit-usability bytes are kit bitfields (IESDP "Header Kit Usability"), not scalar stats; each
    // carries a distinct kit table. They sit non-contiguously (interleaved with the min-stat bytes), so unlike
    // usabilityFlags they stay four separate flag fields rather than one slots array. Canonical doc models a
    // scalar flags field as a string[], like the header `flags` field.
    kitUsability1: { ...itmHeaderSpec.kitUsability1, flags: ItmKitUsabilityByte1Flags },
    kitUsability2: { ...itmHeaderSpec.kitUsability2, flags: ItmKitUsabilityByte2Flags },
    kitUsability3: { ...itmHeaderSpec.kitUsability3, flags: ItmKitUsabilityByte3Flags },
    kitUsability4: { ...itmHeaderSpec.kitUsability4, flags: ItmKitUsabilityByte4Flags },
    // Required weapon proficiency (IESDP "Header Proficiency") - a proficiency-type code, not a scalar. Open
    // because 0x74+ are mod-extensible slots.
    //
    // The install names these: BG/PST ship WPROF.IDS and IWD2 PROFTYPE.IDS, both keyed exactly as the field
    // stores (0x59-0x73, verified against a real BG:EE WPROF.IDS - all 25 of its entries land in that range
    // and none is missing from the vendored table). Near Infinity resolves the field the same way, preferring
    // PROFTYPE. STATS.IDS carries the same names at the same keys and is deliberately NOT a candidate: it is
    // the general 202-entry stat table, so resolving against it would fill the dropdown with stats the field
    // cannot mean.
    weaponProficiency: {
        ...itmHeaderSpec.weaponProficiency,
        enum: ItmWeaponProficiency,
        enumOpen: true,
        ref: { kind: "ids", tables: ["PROFTYPE", "WPROF"] },
    },
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
    // ability-triggered subsets - see IESDP. The split is decided at the
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
