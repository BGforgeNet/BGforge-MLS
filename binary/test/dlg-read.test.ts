import { describe, expect, test } from "vitest";
import { readDlg } from "../src/dlg";

/**
 * Minimal well-formed DLG V1: one state, one transition, one state trigger, one transition trigger,
 * one action, and a trailing text block the three (offset,length) tables point into.
 *
 * Built byte-by-byte rather than committed as a fixture: every real DLG lives inside a game install's
 * BIF archives, which are neither redistributable nor reproducible from this checkout.
 */
const STATE_TRIGGER_TEXT = "NumTimesTalkedTo(0)";
const TRANSITION_TRIGGER_TEXT = 'Global("x","GLOBAL",1)';
const ACTION_TEXT = 'SetGlobal("x","GLOBAL",1)';

const HEADER_SIZE = 0x34;
/** BG1-era files stop before the interrupt-flags dword, so their tables start four bytes earlier. */
const BG1_HEADER_SIZE = 0x30;
const STATE_SIZE = 16;
const TRANSITION_SIZE = 32;
const PAIR_SIZE = 8;

interface BuildOptions {
    transitionFlags?: number;
    /** 0x34 for the post-BG1 header, 0x30 for the BG1-era one. */
    headerSize?: number;
}

function buildMinimalDlg({ transitionFlags = 0b111, headerSize = HEADER_SIZE }: BuildOptions = {}): Uint8Array {
    const stateTableOffset = headerSize;
    const transitionTableOffset = stateTableOffset + STATE_SIZE;
    const stateTriggerOffset = transitionTableOffset + TRANSITION_SIZE;
    const transitionTriggerOffset = stateTriggerOffset + PAIR_SIZE;
    const actionTableOffset = transitionTriggerOffset + PAIR_SIZE;
    const textOffset = actionTableOffset + PAIR_SIZE;

    const stateTriggerAt = textOffset;
    const transitionTriggerAt = stateTriggerAt + STATE_TRIGGER_TEXT.length;
    const actionAt = transitionTriggerAt + TRANSITION_TRIGGER_TEXT.length;
    const total = actionAt + ACTION_TEXT.length;

    const bytes = new Uint8Array(total);
    const view = new DataView(bytes.buffer);
    const ascii = (s: string, at: number): void => {
        for (let i = 0; i < s.length; i++) bytes[at + i] = s.codePointAt(i)!;
    };

    ascii("DLG ", 0x00);
    ascii("V1.0", 0x04);
    view.setUint32(0x08, 1, true); // number of states
    view.setUint32(0x0c, stateTableOffset, true);
    view.setUint32(0x10, 1, true); // number of transitions
    view.setUint32(0x14, transitionTableOffset, true);
    view.setUint32(0x18, stateTriggerOffset, true);
    view.setUint32(0x1c, 1, true); // number of state triggers
    view.setUint32(0x20, transitionTriggerOffset, true);
    view.setUint32(0x24, 1, true); // number of transition triggers
    view.setUint32(0x28, actionTableOffset, true);
    view.setUint32(0x2c, 1, true); // number of actions
    if (headerSize === HEADER_SIZE) view.setUint32(0x30, 0, true); // interrupt flags

    // State: says strref 100, owns the single transition, gated by state trigger 0.
    view.setUint32(stateTableOffset + 0x00, 100, true);
    view.setUint32(stateTableOffset + 0x04, 0, true);
    view.setUint32(stateTableOffset + 0x08, 1, true);
    view.setUint32(stateTableOffset + 0x0c, 0, true);

    // Transition: has text, trigger and action; does not terminate, so it carries next-node information.
    view.setUint32(transitionTableOffset + 0x00, transitionFlags, true);
    view.setUint32(transitionTableOffset + 0x04, 200, true);
    view.setUint32(transitionTableOffset + 0x08, 0, true);
    view.setUint32(transitionTableOffset + 0x0c, 0, true);
    view.setUint32(transitionTableOffset + 0x10, 0, true);
    ascii("NEXTDLG", transitionTableOffset + 0x14);
    view.setUint32(transitionTableOffset + 0x1c, 3, true);

    view.setUint32(stateTriggerOffset + 0x00, stateTriggerAt, true);
    view.setUint32(stateTriggerOffset + 0x04, STATE_TRIGGER_TEXT.length, true);
    view.setUint32(transitionTriggerOffset + 0x00, transitionTriggerAt, true);
    view.setUint32(transitionTriggerOffset + 0x04, TRANSITION_TRIGGER_TEXT.length, true);
    view.setUint32(actionTableOffset + 0x00, actionAt, true);
    view.setUint32(actionTableOffset + 0x04, ACTION_TEXT.length, true);

    ascii(STATE_TRIGGER_TEXT, stateTriggerAt);
    ascii(TRANSITION_TRIGGER_TEXT, transitionTriggerAt);
    ascii(ACTION_TEXT, actionAt);

    return bytes;
}

describe("readDlg - header", () => {
    test("decodes the V1 signature, version and table counts", () => {
        const dlg = readDlg(buildMinimalDlg());

        expect(dlg.signature).toBe("DLG ");
        expect(dlg.version).toBe("V1.0");
        expect(dlg.states).toHaveLength(1);
        expect(dlg.transitions).toHaveLength(1);
    });
});

/**
 * An empty BG1-era dialog, byte for byte: a 48-byte header whose five table offsets all point at its end
 * and whose five counts are zero. Stock BG2:ToB ships fifteen of these.
 */
function buildEmptyBg1Dlg(): Uint8Array {
    const bytes = new Uint8Array(BG1_HEADER_SIZE);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < 4; i++) bytes[i] = "DLG ".codePointAt(i)!;
    for (let i = 0; i < 4; i++) bytes[4 + i] = "V1.0".codePointAt(i)!;
    for (const at of [0x0c, 0x14, 0x18, 0x20, 0x28]) view.setUint32(at, BG1_HEADER_SIZE, true);
    return bytes;
}

describe("readDlg - BG1-era 48-byte header", () => {
    // The interrupt-flags dword at 0x30 is a later addition, so a BG1-era file's tables begin where that
    // field would be. Reading the header as a fixed 52 bytes runs off the end of the shortest such files.
    test("reads a BG1-era dialog's states, transitions and text", () => {
        const dlg = readDlg(buildMinimalDlg({ headerSize: BG1_HEADER_SIZE }));

        expect(dlg.states).toHaveLength(1);
        expect(dlg.transitions).toHaveLength(1);
        expect(dlg.stateTriggers).toEqual([STATE_TRIGGER_TEXT]);
        expect(dlg.actions).toEqual([ACTION_TEXT]);
    });

    test("reads an empty BG1-era dialog, whose whole file is its 48-byte header", () => {
        const dlg = readDlg(buildEmptyBg1Dlg());

        expect(dlg.signature).toBe("DLG ");
        expect(dlg.states).toEqual([]);
        expect(dlg.transitions).toEqual([]);
        expect(dlg.actions).toEqual([]);
    });
});

describe("readDlg - trigger and action tables", () => {
    // The three tables are (offset,length) pairs into a trailing block of NON zero-terminated strings, so a
    // reader that stops at a NUL - or hands the raw pair to its caller - gets this wrong. Resolving them here
    // is what lets a consumer show a dialog's conditions with no compiler and no open install.
    test("resolves state trigger text from its offset/length pair", () => {
        const dlg = readDlg(buildMinimalDlg());

        expect(dlg.stateTriggers).toEqual([STATE_TRIGGER_TEXT]);
    });

    test("resolves transition trigger text from its offset/length pair", () => {
        const dlg = readDlg(buildMinimalDlg());

        expect(dlg.transitionTriggers).toEqual([TRANSITION_TRIGGER_TEXT]);
    });

    test("resolves action text from its offset/length pair", () => {
        const dlg = readDlg(buildMinimalDlg());

        expect(dlg.actions).toEqual([ACTION_TEXT]);
    });
});

describe("readDlg - transition flag readings", () => {
    // Every optional transition field is gated by a flag bit, so the stored value of an unset field is
    // meaningless rather than absent. The raw fields stay faithful to the wire for a future writer; these
    // named readings are what tells a consumer which of them to believe.
    test("a transition carrying next-node information is not a dialog end", () => {
        const dlg = readDlg(buildMinimalDlg());

        expect(dlg.transitions[0]!.terminatesDialog).toBe(false);
    });

    test("a transition with the terminate bit set ends the dialog", () => {
        const dlg = readDlg(buildMinimalDlg({ transitionFlags: 0b1000 }));

        expect(dlg.transitions[0]!.terminatesDialog).toBe(true);
    });

    test("names which optional fields a transition actually carries", () => {
        const dlg = readDlg(buildMinimalDlg({ transitionFlags: 0b111 }));

        expect(dlg.transitions[0]!.hasText).toBe(true);
        expect(dlg.transitions[0]!.hasTrigger).toBe(true);
        expect(dlg.transitions[0]!.hasAction).toBe(true);
        expect(dlg.transitions[0]!.hasJournalEntry).toBe(false);
    });
});
