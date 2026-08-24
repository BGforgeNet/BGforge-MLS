/**
 * Builds a DLG from content, deciding its layout.
 *
 * The sibling to `serializeDlg`, which re-emits a file over its own bytes and therefore cannot change a
 * string's length or add a record. This one owns the layout instead, which is what editing text or structure
 * needs - and what a TypeScript authoring API emitting DLG would go through.
 *
 * The layout is the reference implementation's: the five tables in wire order immediately after the header,
 * then every string appended in table order, no dedup and no terminator. Measured over the 4286 DLGs of a
 * stock BG:EE plus BG2:ToB pair, that reproduces 4203 of them byte for byte. Of the 83 it does not: 80 order
 * the text block by dialog structure rather than by table, and 3 share one offset between identical strings.
 * Both are properties of how a particular file was written rather than of its content, which is why they are
 * reproduced by `serializeDlg` (through the original bytes) and not by a layout rule here.
 */

import { BufferWriter } from "typed-binary";
import {
    dlgHeaderInterruptSchema,
    dlgHeaderSchema,
    dlgStateSchema,
    dlgTextRefSchema,
    dlgTransitionSchema,
} from "./schemas";
import {
    DLG_HEADER_SIZE,
    DLG_HEADER_WITH_INTERRUPT_SIZE,
    type DlgHeaderData,
    type DlgHeaderInterruptData,
} from "./specs/header";
import { DLG_STATE_SIZE, type DlgStateData } from "./specs/state";
import { DLG_TEXT_REF_SIZE, type DlgTextRefData } from "./specs/text-ref";
import { DLG_TRANSITION_SIZE, type DlgTransitionData } from "./specs/transition";

const DLG_SIGNATURE = "DLG ";
const DLG_VERSION_V1 = "V1.0";
const RESREF_SIZE = 8;

/**
 * Everything a DLG holds, minus the header fields that are derived from it. The counts and offsets are the
 * build's own output, so there is nowhere for a caller to state one that disagrees with the content.
 */
export interface DlgBuildInput {
    states: readonly DlgStateData[];
    transitions: readonly DlgTransitionData[];
    /** Indexed by `DlgState.triggerIndex`. */
    stateTriggers: readonly string[];
    /** Indexed by `DlgTransition.triggerIndex`. */
    transitionTriggers: readonly string[];
    /** Indexed by `DlgTransition.actionIndex`. */
    actions: readonly string[];
    /** Later engines append an interrupt-flags dword; omit it for the 48-byte BG1-era header. */
    interrupt?: DlgHeaderInterruptData;
}

/** One byte per character, matching how the reader hands the text block back. */
function latin1Bytes(text: string, where: string): Uint8Array {
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) {
        const code = text.codePointAt(i)!;
        if (code > 0xff) {
            throw new Error(`Cannot store ${where}: character ${JSON.stringify(text[i])} is not a single byte`);
        }
        out[i] = code;
    }
    return out;
}

function resrefBytes(text: string, where: string): void {
    if (text.length !== RESREF_SIZE) {
        throw new Error(`Cannot store ${where}: a resref is ${RESREF_SIZE} bytes, got ${text.length}`);
    }
}

export function buildDlg(input: DlgBuildInput): Uint8Array {
    const headerSize = input.interrupt ? DLG_HEADER_WITH_INTERRUPT_SIZE : DLG_HEADER_SIZE;
    const texts = [
        ...input.stateTriggers.map((s, i) => latin1Bytes(s, `stateTriggers[${i}]`)),
        ...input.transitionTriggers.map((s, i) => latin1Bytes(s, `transitionTriggers[${i}]`)),
        ...input.actions.map((s, i) => latin1Bytes(s, `actions[${i}]`)),
    ];
    input.transitions.forEach((t, i) => resrefBytes(t.nextDialog, `transitions[${i}].nextDialog`));

    const stateTableOffset = headerSize;
    const transitionTableOffset = stateTableOffset + input.states.length * DLG_STATE_SIZE;
    const stateTriggerTableOffset = transitionTableOffset + input.transitions.length * DLG_TRANSITION_SIZE;
    const transitionTriggerTableOffset = stateTriggerTableOffset + input.stateTriggers.length * DLG_TEXT_REF_SIZE;
    const actionTableOffset = transitionTriggerTableOffset + input.transitionTriggers.length * DLG_TEXT_REF_SIZE;
    const textBlockOffset = actionTableOffset + input.actions.length * DLG_TEXT_REF_SIZE;

    const refs: DlgTextRefData[] = [];
    let at = textBlockOffset;
    for (const text of texts) {
        refs.push({ offset: at, length: text.byteLength });
        at += text.byteLength;
    }

    const out = new Uint8Array(at);
    const header: DlgHeaderData = {
        signature: DLG_SIGNATURE,
        version: DLG_VERSION_V1,
        stateCount: input.states.length,
        stateTableOffset,
        transitionCount: input.transitions.length,
        transitionTableOffset,
        stateTriggerTableOffset,
        stateTriggerCount: input.stateTriggers.length,
        transitionTriggerTableOffset,
        transitionTriggerCount: input.transitionTriggers.length,
        actionTableOffset,
        actionCount: input.actions.length,
    };
    writeRecord(out, dlgHeaderSchema, 0, header);
    if (input.interrupt) writeRecord(out, dlgHeaderInterruptSchema, DLG_HEADER_SIZE, input.interrupt);
    input.states.forEach((s, i) => writeRecord(out, dlgStateSchema, stateTableOffset + i * DLG_STATE_SIZE, s));
    input.transitions.forEach((t, i) =>
        writeRecord(out, dlgTransitionSchema, transitionTableOffset + i * DLG_TRANSITION_SIZE, t),
    );

    // One flat ref list over three tables, in the same order the strings were appended.
    const tableStarts = [stateTriggerTableOffset, transitionTriggerTableOffset, actionTableOffset];
    const tableCounts = [input.stateTriggers.length, input.transitionTriggers.length, input.actions.length];
    let ref = 0;
    for (let table = 0; table < tableStarts.length; table++) {
        for (let i = 0; i < tableCounts[table]!; i++, ref++) {
            writeRecord(out, dlgTextRefSchema, tableStarts[table]! + i * DLG_TEXT_REF_SIZE, refs[ref]!);
        }
    }
    texts.forEach((text, i) => out.set(text, refs[i]!.offset));

    return out;
}

/** Shared with the preserve-mode serializer in `index.ts`, so both writers place a record the same way. */
export function writeRecord<T>(
    out: Uint8Array,
    schema: { write: (writer: BufferWriter, value: T) => void },
    offset: number,
    value: T,
): void {
    schema.write(new BufferWriter(out.buffer, { byteOffset: out.byteOffset + offset }), value);
}
