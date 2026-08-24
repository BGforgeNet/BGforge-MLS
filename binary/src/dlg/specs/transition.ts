// Hand-written from IESDP dlg_v1.htm "DLG V1 Transition table". 32 bytes per record.

import { i32, u32 } from "typed-binary";
import { charsSpec, type FieldSpec, type SpecData } from "../../spec/types";

/**
 * Every field after `flags` is conditional on one of its bits, so an unset field's stored value is
 * meaningless rather than absent. The spec keeps them all - the bytes must round-trip either way - and
 * `readDlg` surfaces the bits as named readings saying which to believe.
 *
 * Measured over 80551 transitions in a 4286-file corpus: only bits 0-4 and 6-8 occur. Bits 5, 9 and 10 are
 * named from the spec rather than from observation.
 */
export const dlgTransitionSpec = {
    flags: {
        codec: u32,
        flags: {
            0x001: "Text",
            0x002: "Trigger",
            0x004: "Action",
            0x008: "Terminates Dialog",
            0x010: "Journal Entry",
            0x020: "Interrupt",
            0x040: "Add Unsolved Quest",
            0x080: "Add Journal Note",
            0x100: "Add Solved Quest",
            0x200: "Immediate Execution",
            0x400: "Clear Actions",
        },
    },
    /** Strref of the player's reply; meaningful only under flag bit 0. */
    text: { codec: i32 },
    /** Strref of the journal entry; meaningful only under flag bit 4. */
    journalText: { codec: i32 },
    triggerIndex: { codec: i32 },
    actionIndex: { codec: i32 },
    /** Resref of the DLG holding the next state; meaningful only when flag bit 3 is clear. */
    nextDialog: { ...charsSpec(8), ref: { kind: "resource", type: "DLG" } },
    nextState: { codec: i32 },
} satisfies Record<string, FieldSpec>;

export type DlgTransitionData = SpecData<typeof dlgTransitionSpec>;

export const DLG_TRANSITION_SIZE = 32;
