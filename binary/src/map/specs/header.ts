import { i32, u32 } from "typed-binary";
import { arraySpec, charsSpec, type FieldSpec, type SpecData } from "../../spec/types";
import type { StructPresentation } from "../../spec/presentation";
import { MapElevation, MapFlags, MapVersion, Rotation } from "../types";

/**
 * Wire spec for the MAP header (240 bytes / 0xf0, big-endian).
 *
 * `filename` is 16 raw bytes surfaced as a string via charsSpec.
 *
 * `field_3C` is 44 × i32 of trailing space the file writer reserves for
 * future use; round-trippers preserve the bytes verbatim.
 *
 * `scriptId` is stored as a flat i32 here. The 4-bit type / 24-bit id split
 * lives in script-section parsing (`getScriptType`), not at the header level.
 */
export const mapHeaderSpec = {
    version: { codec: u32, enum: MapVersion },
    // 16-byte NUL-terminated map filename. Wire layout is 16 raw bytes; the
    // chars codec surfaces it as a string in the canonical doc and the
    // editor display tree, with NUL padding preserved on round-trip.
    filename: charsSpec(16),
    defaultPosition: { codec: i32 },
    defaultElevation: { codec: i32, enum: MapElevation },
    defaultOrientation: { codec: i32, enum: Rotation },
    numLocalVars: {
        codec: i32,
        role: "derivedCount" as const,
        derivedFrom: { array: "localVariables" } as const,
    },
    scriptId: { codec: i32 },
    flags: { codec: u32, flags: MapFlags },
    darkness: { codec: i32 },
    numGlobalVars: {
        codec: i32,
        role: "derivedCount" as const,
        derivedFrom: { array: "globalVariables" } as const,
    },
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
 * spec includes `filename` (chars(16), surfaced as a string in the
 * canonical doc) and `field_3C` (44×i32 trailing reserve, not surfaced at
 * all); neither belongs in a `walkGroup` pass. This spec narrows to the
 * 12 numeric fields the canonical document actually carries.
 */
export const mapHeaderCanonicalSpec = {
    version: { codec: u32, enum: MapVersion },
    defaultPosition: { codec: i32 },
    defaultElevation: { codec: i32, enum: MapElevation },
    defaultOrientation: { codec: i32, enum: Rotation },
    numLocalVars: {
        codec: i32,
        role: "derivedCount" as const,
        derivedFrom: { array: "localVariables" } as const,
    },
    scriptId: { codec: i32 },
    flags: { codec: u32, flags: MapFlags },
    darkness: { codec: i32 },
    numGlobalVars: {
        codec: i32,
        role: "derivedCount" as const,
        derivedFrom: { array: "globalVariables" } as const,
    },
    mapId: { codec: i32 },
    timestamp: { codec: u32 },
} satisfies Record<string, FieldSpec>;

export type MapHeaderCanonicalScalars = SpecData<typeof mapHeaderCanonicalSpec>;
