import { i32, u32 } from "typed-binary";
import type { FieldSpec, SpecData } from "../../spec/types";
import type { StructPresentation } from "../../spec/presentation";
import { ScriptFlags, ScriptProc, Skill } from "../types";

/**
 * Wire specs for one MAP script-slot entry, dispatched by `getScriptType(sid)`:
 *
 *   - other (0, 3, etc.): `sid` + `nextScriptLink` + 14 commons → 64 bytes.
 *   - spatial (1):       `sid` + `nextScriptLink` + `builtTile` + `spatialRadius` + 14 commons → 72 bytes.
 *   - timer (2):         `sid` + `nextScriptLink` + `timerTime` + 14 commons → 68 bytes.
 *
 * The orchestrator peeks at the first 4 bytes (sid) to choose the variant
 * before invoking the spec — a discriminator look-ahead, not a primary
 * decode. The spec then re-decodes sid as part of the slot's first field.
 *
 * Subtype dispatch lives in the orchestrator rather than a new spec
 * primitive because the discriminator is a simple per-element peek and
 * the variants share most of their layout — a per-element subtype
 * primitive would carry a large API surface for one consumer.
 */

const COMMON_FIELDS = {
    flags: { codec: i32, flags: ScriptFlags },
    index: { codec: i32 },
    programPointerSlot: { codec: i32 },
    ownerId: { codec: i32 },
    localVarsOffset: { codec: i32 },
    numLocalVars: { codec: i32 },
    returnValue: { codec: i32 },
    action: { codec: i32, enum: ScriptProc },
    fixedParam: { codec: i32 },
    actionBeingUsed: { codec: i32, enum: Skill },
    scriptOverrides: { codec: i32 },
    unknownField0x48: { codec: i32 },
    checkMarginHowMuch: { codec: i32 },
    legacyField0x50: { codec: i32 },
} as const satisfies Record<string, FieldSpec>;

export const otherSlotSpec = {
    sid: { codec: u32 },
    nextScriptLinkLegacy: { codec: i32 },
    ...COMMON_FIELDS,
} as const satisfies Record<string, FieldSpec>;

export const spatialSlotSpec = {
    sid: { codec: u32 },
    nextScriptLinkLegacy: { codec: i32 },
    builtTile: { codec: i32 },
    spatialRadius: { codec: i32 },
    ...COMMON_FIELDS,
} as const satisfies Record<string, FieldSpec>;

export const timerSlotSpec = {
    sid: { codec: u32 },
    nextScriptLinkLegacy: { codec: i32 },
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
    sid: { label: "SID" },
    nextScriptLinkLegacy: { label: "Next Script Link (legacy)" },
    ownerId: { label: "Owner ID" },
    unknownField0x48: { label: "Unknown Field 0x48" },
    checkMarginHowMuch: { label: "Check Margin (how_much)" },
    legacyField0x50: { label: "Legacy Field 0x50" },
} as const;

export const otherSlotPresentation: StructPresentation<OtherSlotData> = COMMON_PRESENTATION;
export const spatialSlotPresentation: StructPresentation<SpatialSlotData> = COMMON_PRESENTATION;
export const timerSlotPresentation: StructPresentation<TimerSlotData> = COMMON_PRESENTATION;
