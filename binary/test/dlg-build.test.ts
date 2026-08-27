import { describe, expect, test } from "vitest";
import { buildDlg, type DlgBuildInput, readDlg, toDlgBuildInput } from "../src/dlg";

/**
 * Building a DLG from nothing, as opposed to re-emitting one over its own bytes.
 *
 * The two are genuinely different jobs. `serializeDlg` preserves a file it was given, which is what an edit
 * to a decoded field needs and what makes the round-trip exact; `buildDlg` decides a layout, which is what
 * editing the text or the structure needs, and what a TypeScript authoring API would emit through. The
 * layout it decides is the reference implementation's: sections in wire order right after the header, then
 * every string appended in table order with no dedup and no terminator. That reproduces 4203 of the 4286
 * DLGs in a stock BG:EE plus BG2:ToB pair byte for byte, and every DLG WeiDU compiles.
 */

const EMPTY: DlgBuildInput = { states: [], transitions: [], stateTriggers: [], transitionTriggers: [], actions: [] };

const HEADER_SIZE = 0x30;
const HEADER_WITH_INTERRUPT_SIZE = 0x34;
const STATE_SIZE = 16;
const TRANSITION_SIZE = 32;
const PAIR_SIZE = 8;

function state(overrides: Partial<DlgBuildInput["states"][number]> = {}): DlgBuildInput["states"][number] {
    return { text: 100, firstTransition: 0, transitionCount: 1, triggerIndex: 0, ...overrides };
}

function transition(
    overrides: Partial<DlgBuildInput["transitions"][number]> = {},
): DlgBuildInput["transitions"][number] {
    return {
        flags: ["text", "trigger", "action"],
        text: 200,
        journalText: 0,
        triggerIndex: 0,
        actionIndex: 0,
        nextDialog: "\u0000".repeat(8),
        nextState: 0,
        ...overrides,
    };
}

/** The header's table offsets, which is where a layout decision shows up. */
function tableOffsets(bytes: Uint8Array): Record<string, number> {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return {
        states: view.getUint32(0x0c, true),
        transitions: view.getUint32(0x14, true),
        stateTriggers: view.getUint32(0x18, true),
        transitionTriggers: view.getUint32(0x20, true),
        actions: view.getUint32(0x28, true),
    };
}

describe("buildDlg - what it produces", () => {
    test("builds a file the reader reads back unchanged", () => {
        const input: DlgBuildInput = {
            states: [state()],
            transitions: [transition()],
            stateTriggers: ["NumTimesTalkedTo(0)"],
            transitionTriggers: ['Global("x","GLOBAL",1)'],
            actions: ['SetGlobal("x","GLOBAL",2)'],
        };

        const dlg = readDlg(buildDlg(input));

        expect(dlg.signature).toBe("DLG ");
        expect(dlg.version).toBe("V1.0");
        expect(dlg.states).toEqual(input.states);
        expect(dlg.stateTriggers).toEqual(input.stateTriggers);
        expect(dlg.transitionTriggers).toEqual(input.transitionTriggers);
        expect(dlg.actions).toEqual(input.actions);
    });

    test("derives the header counts from the content, so a caller cannot desync them", () => {
        const bytes = buildDlg({
            ...EMPTY,
            states: [state(), state()],
            transitions: [transition(), transition(), transition()],
            actions: ["Wait(1)"],
        });
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

        expect(view.getUint32(0x08, true)).toBe(2); // states
        expect(view.getUint32(0x10, true)).toBe(3); // transitions
        expect(view.getUint32(0x2c, true)).toBe(1); // actions
    });

    test("lays the five tables out in wire order, starting at the end of the header", () => {
        const bytes = buildDlg({
            ...EMPTY,
            states: [state(), state()],
            transitions: [transition()],
            stateTriggers: ["a"],
            transitionTriggers: ["b"],
            actions: ["c"],
            interrupt: { interruptFlags: [] },
        });

        expect(tableOffsets(bytes)).toEqual({
            states: HEADER_WITH_INTERRUPT_SIZE,
            transitions: HEADER_WITH_INTERRUPT_SIZE + 2 * STATE_SIZE,
            stateTriggers: HEADER_WITH_INTERRUPT_SIZE + 2 * STATE_SIZE + TRANSITION_SIZE,
            transitionTriggers: HEADER_WITH_INTERRUPT_SIZE + 2 * STATE_SIZE + TRANSITION_SIZE + PAIR_SIZE,
            actions: HEADER_WITH_INTERRUPT_SIZE + 2 * STATE_SIZE + TRANSITION_SIZE + 2 * PAIR_SIZE,
        });
    });

    test("appends identical strings twice rather than sharing one offset", () => {
        // Deduplicating would be smaller and is what 3 of 4286 real files do, but the reference
        // implementation does not, and a shared offset is a fact about a file rather than about its content.
        const bytes = buildDlg({ ...EMPTY, actions: ["Wait(1)", "Wait(1)"] });
        const dlg = readDlg(bytes);

        expect(dlg.actions).toEqual(["Wait(1)", "Wait(1)"]);
        expect(bytes.byteLength).toBe(HEADER_SIZE + 2 * PAIR_SIZE + 2 * "Wait(1)".length);
    });

    test("stores strings with no terminator between them", () => {
        // The three tables are (offset,length) pairs, so a terminator would be content - and a reader that
        // stopped at one would truncate every string a producer packed tightly.
        const bytes = buildDlg({ ...EMPTY, stateTriggers: ["ab", "cd"] });

        expect([...bytes.subarray(bytes.byteLength - 4)]).toEqual([...Buffer.from("abcd", "latin1")]);
    });

    test("ends the file at the last string, with no trailing slack", () => {
        const bytes = buildDlg({ ...EMPTY, actions: ["Wait(1)"] });

        expect(bytes.byteLength).toBe(HEADER_SIZE + PAIR_SIZE + "Wait(1)".length);
    });
});

describe("buildDlg - header variant", () => {
    test("omitting the interrupt field produces the 48-byte BG1-era header", () => {
        const bytes = buildDlg({ ...EMPTY, states: [state()] });

        expect(tableOffsets(bytes).states).toBe(HEADER_SIZE);
        expect(bytes.byteLength).toBe(HEADER_SIZE + STATE_SIZE);
    });

    test("supplying it produces the 52-byte header and stores the flags", () => {
        const bytes = buildDlg({ ...EMPTY, states: [state()], interrupt: { interruptFlags: ["escapeArea"] } });

        expect(tableOffsets(bytes).states).toBe(HEADER_WITH_INTERRUPT_SIZE);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        expect(view.getUint32(0x30, true)).toBe(0x2);
    });
});

describe("buildDlg - rejected input", () => {
    test("refuses a string the format cannot store", () => {
        // A DLG's text block is bytes, and the reader hands them back one byte per character. A code point
        // above 0xff has no byte, so silently narrowing it would corrupt the text on the way out.
        expect(() => buildDlg({ ...EMPTY, actions: ["Wait(\u0141)"] })).toThrow(/actions\[0\]/);
    });

    test("refuses a resref that is not eight bytes", () => {
        // The field is fixed-width, so a short one would shift every following field of the record.
        expect(() => buildDlg({ ...EMPTY, transitions: [transition({ nextDialog: "SHORT" })] })).toThrow(/nextDialog/);
    });
});

describe("toDlgBuildInput", () => {
    test("recovers a file's content, so rebuilding an unedited file is expressible", () => {
        const original = buildDlg({
            ...EMPTY,
            states: [state()],
            transitions: [transition()],
            stateTriggers: ["NumTimesTalkedTo(0)"],
            transitionTriggers: ['Global("x","GLOBAL",1)'],
            actions: ['SetGlobal("x","GLOBAL",2)'],
            interrupt: { interruptFlags: ["enemy"] },
        });

        const round = buildDlg(toDlgBuildInput(original));

        expect([...round]).toEqual([...original]);
    });

    test("carries the header variant, so a BG1-era file does not gain a field on rebuild", () => {
        const original = buildDlg({ ...EMPTY, actions: ["Wait(1)"] });

        const round = buildDlg(toDlgBuildInput(original));

        expect(round.byteLength).toBe(original.byteLength);
        expect(tableOffsets(round).actions).toBe(HEADER_SIZE);
    });
});
