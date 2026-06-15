import { i32, u32 } from "typed-binary";
import type { FieldSpec, SpecData } from "../../spec/types";
import type { StructPresentation } from "../../spec/presentation";
import { ScriptFlags, ScriptProc, Skill } from "../types";

/**
 * Wire specs for one MAP script-slot entry, dispatched by `getScriptType(sid)`:
 *
 *   - other (0, 3, etc.): `sid` + `nextScriptLink` + 14 commons -> 64 bytes.
 *   - spatial (1):       `sid` + `nextScriptLink` + `builtTile` + `spatialRadius` + 14 commons -> 72 bytes.
 *   - timer (2):         `sid` + `nextScriptLink` + `timerTime` + 14 commons -> 68 bytes.
 *
 * The orchestrator peeks at the first 4 bytes (sid) to choose the variant
 * before invoking the spec - a discriminator look-ahead, not a primary
 * decode. The spec then re-decodes sid as part of the slot's first field.
 *
 * Subtype dispatch lives in the orchestrator rather than a new spec
 * primitive because the discriminator is a simple per-element peek and
 * the variants share most of their layout - a per-element subtype
 * primitive would carry a large API surface for one consumer.
 */

const COMMON_FIELDS = {
    flags: { codec: i32, flags: ScriptFlags },
    index: { codec: i32 },
    // Engine-set internal pointer; not user data.
    programPointerSlot: { codec: i32, role: "reserved" as const },
    ownerId: { codec: i32 },
    // Per-slot offset into the file's local-vars section. Round-trip
    // preserves the wire value; the Fallout MAP format does not document a
    // clean derivation formula the writer can recompute, so the role tag is
    // editor-lock-only ("reserved" rather than "derivedOffset").
    localVarsOffset: { codec: i32, role: "reserved" as const },
    // Per-slot count of local vars. The flat doc-level localVariables array
    // is the source of total length; per-slot subdivision is engine-managed
    // metadata, not derivable from doc shape alone.
    numLocalVars: { codec: i32, role: "reserved" as const },
    returnValue: { codec: i32 },
    action: { codec: i32, enum: ScriptProc },
    fixedParam: { codec: i32 },
    actionBeingUsed: { codec: i32, enum: Skill },
    scriptOverrides: { codec: i32 },
    // Reserved / unknown int32s preserved for round-trip; user shouldn't edit. field_48 and field_50 are
    // engine-internal (field_48 is referenced nowhere in fallout2-ce; field_50 is runtime string-lookup
    // scratch) - not authored data, so they are hidden from the detail (still round-tripped via the doc).
    unknownField0x48: { codec: i32, role: "reserved" as const, hidden: true },
    checkMarginHowMuch: { codec: i32 },
    legacyField0x50: { codec: i32, role: "reserved" as const, hidden: true },
} as const satisfies Record<string, FieldSpec>;

export const otherSlotSpec = {
    sid: { codec: u32 },
    // field_4 (scr_next): a legacy linked-list pointer fallout2-ce reads and writes but consumes nowhere.
    // Engine-internal, not authored map data - locked and hidden (round-trips via the canonical document).
    nextScriptLinkLegacy: { codec: i32, role: "reserved" as const, hidden: true },
    ...COMMON_FIELDS,
} as const satisfies Record<string, FieldSpec>;

export const spatialSlotSpec = {
    sid: { codec: u32 },
    // field_4 (scr_next): a legacy linked-list pointer fallout2-ce reads and writes but consumes nowhere.
    // Engine-internal, not authored map data - locked and hidden (round-trips via the canonical document).
    nextScriptLinkLegacy: { codec: i32, role: "reserved" as const, hidden: true },
    builtTile: { codec: i32 },
    spatialRadius: { codec: i32 },
    ...COMMON_FIELDS,
} as const satisfies Record<string, FieldSpec>;

export const timerSlotSpec = {
    sid: { codec: u32 },
    // field_4 (scr_next): a legacy linked-list pointer fallout2-ce reads and writes but consumes nowhere.
    // Engine-internal, not authored map data - locked and hidden (round-trips via the canonical document).
    nextScriptLinkLegacy: { codec: i32, role: "reserved" as const, hidden: true },
    timerTime: { codec: i32 },
    ...COMMON_FIELDS,
} as const satisfies Record<string, FieldSpec>;

export type OtherSlotData = SpecData<typeof otherSlotSpec>;
export type SpatialSlotData = SpecData<typeof spatialSlotSpec>;
export type TimerSlotData = SpecData<typeof timerSlotSpec>;

export const OTHER_SLOT_BYTES = 4 + 4 + 14 * 4;
export const SPATIAL_SLOT_BYTES = 4 + 4 + 4 + 4 + 14 * 4;
export const TIMER_SLOT_BYTES = 4 + 4 + 4 + 14 * 4;

/**
 * Display labels for slot fields. Acronym keys (`sid`) and labels with
 * legacy parenthetical hints (`Next Script Link (legacy)`,
 * `Check Margin (how_much)`) don't round-trip through humanize; override
 * them. The hex-suffix fields (`unknownField0x48`, `legacyField0x50`)
 * also need explicit labels because humanize doesn't insert spaces
 * before digits.
 */
const COMMON_PRESENTATION = {
    // The script ID is a packed (type<<24 | index) dword; show it in hex so the type byte is legible, the same
    // treatment object FID/PID get. (walkStruct stamps numericFormat from this spec presentation.)
    sid: { label: "SID", format: "hex32" },
    nextScriptLinkLegacy: { label: "Next Script Link (legacy)" },
    // The owner is an object self-id using the same (type<<24 | index) packing as SID/FID/PID, and is commonly
    // a sentinel on disk (-1 "none", -2, 0xCCCCCCCC uninitialized fill the engine rebinds at load). Show it in
    // hex so the type byte is legible and the sentinels read as 0xFFFFFFFF / 0xCCCCCCCC rather than confusing
    // signed decimals (e.g. -858993460). Same i32+hex32 treatment as the object PID.
    ownerId: { label: "Owner ID", format: "hex32" },
    unknownField0x48: { label: "Unknown Field 0x48" },
    checkMarginHowMuch: { label: "Check Margin (how_much)" },
    legacyField0x50: { label: "Legacy Field 0x50" },
} as const;

export const otherSlotPresentation: StructPresentation<OtherSlotData> = COMMON_PRESENTATION;
export const spatialSlotPresentation: StructPresentation<SpatialSlotData> = COMMON_PRESENTATION;
export const timerSlotPresentation: StructPresentation<TimerSlotData> = COMMON_PRESENTATION;
