/**
 * The DLG layouts a real install contains, assembled byte by byte.
 *
 * These stand in for the install sweep (`dlg-corpus.test.ts`), which needs a game to point at and so never
 * runs in CI. Every variant here was found in a stock BG:EE plus BG2:ToB pair, and the count beside each is
 * how many of those 4286 files carry it.
 *
 * Assembled here rather than committed as `.dlg` files for two reasons: a binary blob is unreviewable in a
 * diff, where this spells out exactly what makes each variant a variant; and `buildDlg` cannot produce most
 * of them, which is the whole point - it writes one layout, and these are the ones it does not write. The
 * assembler is independent of the reader (it lays bytes down from a spec rather than sharing its parsing),
 * so a misreading is not shared between the two.
 */

const STATE_SIZE = 16;
const TRANSITION_SIZE = 32;
const PAIR_SIZE = 8;

interface Ref {
    text: string;
    /** Pin this ref to an offset instead of appending, so two refs can share one. */
    at?: number;
}

interface Layout {
    /** 0x34 for the post-BG1 header, 0x30 for the BG1-era one that omits the interrupt-flags dword. */
    headerSize: 0x30 | 0x34;
    /** Each state as [text, firstTransition, transitionCount, triggerIndex]. */
    states: number[][];
    /** Each transition as [flags, text, journalText, triggerIndex, actionIndex, nextState]. */
    transitions: number[][];
    stateTriggers: Ref[];
    transitionTriggers: Ref[];
    actions: Ref[];
    /** Bytes after the text block. */
    trailing?: number[];
    /** Lay the text block out in this order (indices into the flat ref list) rather than in table order. */
    textOrder?: number[];
}

function assemble(layout: Layout): Uint8Array {
    const refs = [...layout.stateTriggers, ...layout.transitionTriggers, ...layout.actions];
    const stateTable = layout.headerSize;
    const transitionTable = stateTable + layout.states.length * STATE_SIZE;
    const stateTriggerTable = transitionTable + layout.transitions.length * TRANSITION_SIZE;
    const transitionTriggerTable = stateTriggerTable + layout.stateTriggers.length * PAIR_SIZE;
    const actionTable = transitionTriggerTable + layout.transitionTriggers.length * PAIR_SIZE;

    const order = layout.textOrder ?? refs.map((_, i) => i);
    const offsets: number[] = Array.from({ length: refs.length }, () => 0);
    let at = actionTable + layout.actions.length * PAIR_SIZE;
    for (const index of order) {
        const ref = refs[index]!;
        offsets[index] = ref.at ?? at;
        if (ref.at === undefined) at += ref.text.length;
    }
    const end = at + (layout.trailing?.length ?? 0);

    const bytes = new Uint8Array(end);
    const view = new DataView(bytes.buffer);
    const ascii = (text: string, offset: number): void => {
        for (let i = 0; i < text.length; i++) bytes[offset + i] = text.codePointAt(i)!;
    };

    ascii("DLG ", 0);
    ascii("V1.0", 4);
    view.setUint32(0x08, layout.states.length, true);
    view.setUint32(0x0c, stateTable, true);
    view.setUint32(0x10, layout.transitions.length, true);
    view.setUint32(0x14, transitionTable, true);
    view.setUint32(0x18, stateTriggerTable, true);
    view.setUint32(0x1c, layout.stateTriggers.length, true);
    view.setUint32(0x20, transitionTriggerTable, true);
    view.setUint32(0x24, layout.transitionTriggers.length, true);
    view.setUint32(0x28, actionTable, true);
    view.setUint32(0x2c, layout.actions.length, true);
    if (layout.headerSize === 0x34) view.setUint32(0x30, 0, true);

    layout.states.forEach((state, i) =>
        state.forEach((value, j) => view.setInt32(stateTable + i * STATE_SIZE + j * 4, value, true)),
    );
    layout.transitions.forEach((transition, i) => {
        const base = transitionTable + i * TRANSITION_SIZE;
        transition.slice(0, 5).forEach((value, j) => view.setInt32(base + j * 4, value, true));
        ascii("NEXTDLG ", base + 0x14);
        view.setInt32(base + 0x1c, transition[5] ?? 0, true);
    });

    const tables: [number, number, number][] = [
        [stateTriggerTable, 0, layout.stateTriggers.length],
        [transitionTriggerTable, layout.stateTriggers.length, layout.transitionTriggers.length],
        [actionTable, layout.stateTriggers.length + layout.transitionTriggers.length, layout.actions.length],
    ];
    for (const [table, first, count] of tables) {
        for (let i = 0; i < count; i++) {
            view.setUint32(table + i * PAIR_SIZE, offsets[first + i]!, true);
            view.setUint32(table + i * PAIR_SIZE + 4, refs[first + i]!.text.length, true);
        }
    }
    for (const [i, ref] of refs.entries()) ascii(ref.text, offsets[i]!);
    layout.trailing?.forEach((byte, i) => {
        bytes[end - layout.trailing!.length + i] = byte;
    });
    return bytes;
}

export interface DlgVariant {
    name: string;
    /** What makes this file different, and how much of a stock install carries it. */
    why: string;
    bytes: Uint8Array;
    /** Whether `buildDlg` writes this layout, and so whether a rebuild can be byte-identical. */
    canonicalLayout: boolean;
}

const SHARED_OFFSET = 0x34 + STATE_SIZE + TRANSITION_SIZE + PAIR_SIZE * 3;

export const DLG_VARIANTS: DlgVariant[] = [
    {
        name: "standard",
        why: "the post-BG1 header and the ordinary layout, which most of an install uses",
        canonicalLayout: true,
        bytes: assemble({
            headerSize: 0x34,
            states: [
                [100, 0, 2, 0],
                [101, 2, 1, -1],
            ],
            transitions: [
                [0b0111, 200, 0, 0, 0, 1],
                [0b1000, 201, 0, 0, 0, 0],
                [0b0001, 202, 0, -1, -1, 0],
            ],
            stateTriggers: [{ text: "NumTimesTalkedTo(0)" }],
            transitionTriggers: [{ text: 'Global("x","GLOBAL",1)' }],
            actions: [{ text: 'SetGlobal("x","GLOBAL",2)' }],
        }),
    },
    {
        name: "bg1-header",
        why: "the 48-byte BG1-era header, which omits the interrupt-flags dword - 1002 of 4286 files",
        canonicalLayout: true,
        bytes: assemble({
            headerSize: 0x30,
            states: [[421, 0, 1, 0]],
            transitions: [[0b1001, 430, 0, 0, 0, 0]],
            stateTriggers: [{ text: 'Dead("Ragefast")' }],
            transitionTriggers: [],
            actions: [{ text: "EscapeArea()" }],
        }),
    },
    {
        name: "bg1-empty",
        why: "a BG1-era header and nothing else: the whole file is 48 bytes - 15 of 4286 files",
        canonicalLayout: true,
        bytes: assemble({
            headerSize: 0x30,
            states: [],
            transitions: [],
            stateTriggers: [],
            transitionTriggers: [],
            actions: [],
        }),
    },
    {
        name: "shared-offset",
        why: "two refs pointing at one string - 547 files, and recomputing offsets would split them",
        canonicalLayout: false,
        bytes: assemble({
            headerSize: 0x34,
            states: [[100, 0, 1, 0]],
            transitions: [[0b0111, 200, 0, 0, 0, 0]],
            stateTriggers: [{ text: 'Global("a","GLOBAL",1)' }],
            transitionTriggers: [{ text: 'Global("a","GLOBAL",1)', at: SHARED_OFFSET }],
            actions: [{ text: "NoAction()" }],
        }),
    },
    {
        name: "structure-ordered-text",
        why: "a text block ordered by dialog structure rather than by table - 80 files",
        canonicalLayout: false,
        bytes: assemble({
            headerSize: 0x34,
            states: [[100, 0, 1, 0]],
            transitions: [[0b0111, 200, 0, 0, 0, 0]],
            stateTriggers: [{ text: "NumTimesTalkedTo(0)" }],
            transitionTriggers: [{ text: 'Global("x","GLOBAL",1)' }],
            actions: [{ text: 'SetGlobal("x","GLOBAL",2)' }],
            textOrder: [0, 2, 1],
        }),
    },
    {
        name: "trailing-slack",
        why: "bytes after the last string, which the reader keeps by taking the block to EOF",
        canonicalLayout: false,
        bytes: assemble({
            headerSize: 0x34,
            states: [[100, 0, 1, 0]],
            transitions: [[0b0111, 200, 0, 0, 0, 0]],
            stateTriggers: [{ text: "True()" }],
            transitionTriggers: [],
            actions: [{ text: "NoAction()" }],
            trailing: [0x00, 0x00, 0x41, 0x42],
        }),
    },
];
