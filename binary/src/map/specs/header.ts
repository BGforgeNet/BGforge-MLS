import { i32, u8, u32 } from "typed-binary";
import { arraySpec, type FieldSpec, type SpecData } from "../../spec/types";
import type { StructPresentation } from "../../spec/presentation";
import { MapElevation, MapFlags, MapVersion, Rotation } from "../types";

/**
 * Wire spec for the MAP header (240 bytes / 0xf0, big-endian).
 *
 * `filename` is 16 raw bytes; the canonical layer (and the public MapHeader
 * shape) converts to a NUL-terminated string. Keeping it as a u8 array in the
 * spec keeps the spec primitive scalar-only — extending the primitive to
 * support a `chars(N)` codec is a separate, larger change.
 *
 * `field_3C` is 44 × i32 of trailing space the file writer reserves for
 * future use; round-trippers preserve the bytes verbatim.
 *
 * `scriptId` is stored as a flat i32 here. The 4-bit type / 24-bit id split
 * lives in script-section parsing (`getScriptType`), not at the header level.
 */
export const mapHeaderSpec = {
    version: { codec: u32, enum: MapVersion },
    filename: arraySpec({ element: { codec: u8 }, count: 16 }),
    defaultPosition: { codec: i32 },
    defaultElevation: { codec: i32, enum: MapElevation },
    defaultOrientation: { codec: i32, enum: Rotation },
    numLocalVars: { codec: i32 },
    scriptId: { codec: i32 },
    flags: { codec: u32, flags: MapFlags },
    darkness: { codec: i32 },
    numGlobalVars: { codec: i32 },
    mapId: { codec: i32 },
    timestamp: { codec: u32 },
    field_3C: arraySpec({ element: { codec: i32 }, count: 44 }),
} satisfies Record<string, FieldSpec>;

export type MapHeaderWireData = SpecData<typeof mapHeaderSpec>;

/**
 * Display labels for the header fields. Keys without an entry fall back to
 * `humanize(fieldName)`. Overrides cover acronyms (`scriptId`→"Script ID"),
 * the `flags`→"Map Flags" rename used in the binary editor, and the
 * `mapId`→"Map ID" disambiguation.
 */
export const mapHeaderPresentation: StructPresentation<MapHeaderWireData> = {
    scriptId: { label: "Script ID" },
    flags: { label: "Map Flags" },
    mapId: { label: "Map ID" },
};

/**
 * Scalar-only view of the header for canonical-reader walking. The wire
 * spec includes `filename` (u8[16], surfaced as a string in the canonical
 * doc) and `field_3C` (44×i32 trailing reserve, not surfaced at all);
 * neither belongs in a `walkGroup` pass. This spec narrows to the 12
 * numeric fields the canonical document actually carries.
 */
export const mapHeaderCanonicalSpec = {
    version: { codec: u32, enum: MapVersion },
    defaultPosition: { codec: i32 },
    defaultElevation: { codec: i32, enum: MapElevation },
    defaultOrientation: { codec: i32, enum: Rotation },
    numLocalVars: { codec: i32 },
    scriptId: { codec: i32 },
    flags: { codec: u32, flags: MapFlags },
    darkness: { codec: i32 },
    numGlobalVars: { codec: i32 },
    mapId: { codec: i32 },
    timestamp: { codec: u32 },
} satisfies Record<string, FieldSpec>;

export type MapHeaderCanonicalScalars = SpecData<typeof mapHeaderCanonicalSpec>;
