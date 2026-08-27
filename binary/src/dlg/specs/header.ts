// Hand-written from IESDP dlg_v1.htm "DLG V1 Header". IESDP publishes no `_data/` YAML for DLG, so unlike
// ITM/SPL/EFF there is no generator for this spec.

import { u32 } from "typed-binary";
import { charsSpec, type FieldSpec, type SpecData } from "../../spec/types";

/**
 * The 48 bytes every DLG V1 header carries, BG1-era files included.
 *
 * Note the ordering asymmetry, which is the format's own and a standing trap: the state and transition
 * tables store count before offset, while the three text tables store offset before count.
 */
export const dlgHeaderSpec = {
    signature: charsSpec(4),
    version: charsSpec(4),
    stateCount: { codec: u32 },
    stateTableOffset: { codec: u32 },
    transitionCount: { codec: u32 },
    transitionTableOffset: { codec: u32 },
    stateTriggerTableOffset: { codec: u32 },
    stateTriggerCount: { codec: u32 },
    transitionTriggerTableOffset: { codec: u32 },
    transitionTriggerCount: { codec: u32 },
    actionTableOffset: { codec: u32 },
    actionCount: { codec: u32 },
} satisfies Record<string, FieldSpec>;

/**
 * The dword later engines append at 0x30: what the creature does when a hostile action interrupts the
 * dialog. It is its own struct rather than a trailing header field because BG1-era files genuinely do not
 * have it - their first table starts where it would be - and decoding one there would read table bytes.
 */
export const dlgHeaderInterruptSpec = {
    interruptFlags: { codec: u32, flags: { 0x1: "Enemy", 0x2: "EscapeArea", 0x4: "Nothing" } },
} satisfies Record<string, FieldSpec>;

export type DlgHeaderData = SpecData<typeof dlgHeaderSpec>;
export type DlgHeaderInterruptData = SpecData<typeof dlgHeaderInterruptSpec>;

/** The base header, which is the whole header in a BG1-era file. */
export const DLG_HEADER_SIZE = 0x30;
/** The base header plus the interrupt-flags dword - what every post-BG1 file writes. */
export const DLG_HEADER_WITH_INTERRUPT_SIZE = 0x34;
