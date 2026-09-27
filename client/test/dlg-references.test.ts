import { describe, expect, it } from "vitest";
import { buildDlg, type DlgBuildInput } from "@bgforge/binary";
import {
    DlgReferenceIndex,
    NEIGHBOUR_STATE_LIMIT,
    neighbourStates,
    type DlgSource,
} from "../src/dialog-editor/dlg-references";

const resref = (name: string) => name.padEnd(8, "\0");

/** A transition going to `nextDialog`:`nextState`; an empty resref means "this same dialog". */
function to(nextDialog: string, nextState: number): DlgBuildInput["transitions"][number] {
    return {
        flags: ["text"],
        text: 1,
        journalText: -1,
        triggerIndex: -1,
        actionIndex: -1,
        nextDialog: resref(nextDialog),
        nextState,
    };
}

const exit = (): DlgBuildInput["transitions"][number] => ({ ...to("", 0), flags: ["terminatesDialog"] });

function dlg(states: [first: number, count: number][], transitions: DlgBuildInput["transitions"]): Uint8Array {
    return buildDlg({
        states: states.map(([firstTransition, transitionCount]) => ({
            text: 1,
            firstTransition,
            transitionCount,
            triggerIndex: -1,
        })),
        transitions,
        stateTriggers: [],
        transitionTriggers: [],
        actions: [],
    });
}

/**
 * Two dialogs. HELLO state 0 offers three replies: one inside HELLO, one into OTHER, one that ends the
 * conversation. OTHER state 1 jumps back into HELLO, which is the out-and-back shape.
 */
function source(): DlgSource {
    const files: Record<string, Uint8Array> = {
        HELLO: dlg(
            [
                [0, 3],
                [3, 0],
            ],
            [to("", 1), to("OTHER", 1), exit()],
        ),
        OTHER: dlg(
            [
                [0, 0],
                [0, 1],
            ],
            [to("HELLO", 0)],
        ),
    };
    return { list: () => Object.keys(files), read: (name) => files[name]! };
}

describe("DlgReferenceIndex", () => {
    const built = async () => {
        const index = new DlgReferenceIndex();
        await index.build(source());
        return index;
    };

    it("finds a reply in another dialog that jumps into this one", async () => {
        const index = await built();

        expect(index.inbound("HELLO", 0)).toEqual([{ dialog: "OTHER", state: 1, transition: 0 }]);
    });

    it("finds a reply within the same dialog, naming the state that owns it", async () => {
        const index = await built();

        // HELLO's own state 0 offers the reply that leads to state 1.
        expect(index.inbound("HELLO", 1)).toEqual([{ dialog: "HELLO", state: 0, transition: 0 }]);
    });

    it("reports a state nothing points at as having no inbound references", async () => {
        const index = await built();

        expect(index.inbound("OTHER", 0)).toEqual([]);
    });

    it("does not count a reply that ends the conversation as pointing anywhere", async () => {
        const index = await built();

        // The exit transition stores nextState 0; read without checking the flag it would look like a jump.
        expect(index.inbound("HELLO", 0).some((r) => r.dialog === "HELLO")).toBe(false);
    });

    it("is not ready before it is built, which is not the same as finding nothing", async () => {
        const index = new DlgReferenceIndex();

        expect(index.ready).toBe(false);
        await index.build(source());
        expect(index.ready).toBe(true);
    });

    it("skips a dialog it cannot read rather than abandoning the scan", async () => {
        const index = new DlgReferenceIndex();
        const broken: DlgSource = {
            list: () => ["BROKEN", "OTHER"],
            read: (name) => (name === "BROKEN" ? new Uint8Array(4) : source().read(name)),
        };

        await index.build(broken);

        expect(index.ready).toBe(true);
        expect(index.inbound("HELLO", 0)).toEqual([{ dialog: "OTHER", state: 1, transition: 0 }]);
    });

    it("does not claim to be ready when cancelled while reading the last dialog", async () => {
        // Aborting between the loop's last check and the end of the scan is the window an abort actually
        // lands in; without a check after the loop the index would publish a half-built answer as complete.
        const index = new DlgReferenceIndex();
        const controller = new AbortController();
        const base = source();
        const late: DlgSource = {
            list: () => base.list(),
            read: (name) => {
                if (name === base.list().at(-1)) controller.abort();
                return base.read(name);
            },
        };

        await index.build(late, controller.signal);

        expect(index.ready).toBe(false);
    });

    it("stops when the build is cancelled, and does not claim to be ready", async () => {
        const index = new DlgReferenceIndex();
        const controller = new AbortController();
        controller.abort();

        await index.build(source(), controller.signal);

        expect(index.ready).toBe(false);
    });
});

describe("DlgReferenceIndex.inboundToDialog - which replies elsewhere reach into this one", () => {
    async function built(): Promise<DlgReferenceIndex> {
        const index = new DlgReferenceIndex();
        await index.build(source());
        return index;
    }

    it("names the reply that jumps in, not just the file it came from", async () => {
        const index = await built();

        // The STATE holding the reply is what the tree draws, so the state number has to survive.
        expect(index.inboundToDialog("HELLO")).toEqual([{ dialog: "OTHER", state: 1, transition: 0 }]);
    });

    it("leaves out the dialog's own internal jumps - those are already in the file", async () => {
        const index = await built();

        // HELLO state 0 jumps to HELLO state 1; that is not another file arriving.
        expect(index.inboundToDialog("HELLO").map((r) => r.dialog)).not.toContain("HELLO");
    });

    it("answers with nothing for a dialog nobody reaches", async () => {
        const index = await built();

        expect(index.inboundToDialog("NOBODY")).toEqual([]);
    });
});

describe("DlgReferenceIndex.build - a scan of a whole game", () => {
    it("hands the host back the event loop while scanning, and still indexes every file", async () => {
        // A real install holds thousands of dialogs. The scan yields between chunks so it stays a background
        // job; this crosses that boundary, which a two-file source never does.
        const count = 120;
        const files = Object.fromEntries(
            Array.from({ length: count }, (_, i) => [`D${i}`, dlg([[0, 1]], [to("TARGET", i)])]),
        );
        const index = new DlgReferenceIndex();

        await index.build({ list: () => Object.keys(files), read: (name) => files[name]! });

        expect(index.ready).toBe(true);
        expect(index.inboundToDialog("TARGET")).toHaveLength(count);
    });

    it("abandons the whole scan on abort rather than leaving a half-index that looks authoritative", async () => {
        const controller = new AbortController();
        controller.abort();
        const index = new DlgReferenceIndex();

        await index.build(source(), controller.signal);

        expect(index.ready).toBe(false);
    });
});

describe("neighbourStates - which states to draw alongside the one being edited", () => {
    const out = (dialog: string, state: number) => ({ dialog, state });
    const inn = (dialog: string, state: number) => ({ dialog, state, transition: 0 });

    it("brings in the states this dialog reaches and the states that reach it", () => {
        const { load, omitted } = neighbourStates([out("OTHER", 4)], [inn("THIRD", 2)], "HELLO");

        expect([...load]).toEqual([
            ["OTHER", [4]],
            ["THIRD", [2]],
        ]);
        expect(omitted).toBe(0);
    });

    it("leaves this dialog's own states out - they are already the tree", () => {
        expect([...neighbourStates([out("HELLO", 1)], [inn("HELLO", 0)], "HELLO").load]).toEqual([]);
    });

    it("names each state once, however many replies lead there", () => {
        const { load } = neighbourStates([out("OTHER", 4), out("OTHER", 4), out("OTHER", 7)], [], "HELLO");

        expect(load.get("OTHER")).toEqual([4, 7]);
    });

    it("stops at a bound and says how many it left out, rather than drawing a whole game", () => {
        const many = Array.from({ length: NEIGHBOUR_STATE_LIMIT + 6 }, (_, i) => out("OTHER", i));

        const { load, omitted } = neighbourStates(many, [], "HELLO");

        expect(load.get("OTHER")).toHaveLength(NEIGHBOUR_STATE_LIMIT);
        expect(omitted).toBe(6);
    });

    it("keeps the states this dialog hands off to ahead of the ones that hand off to it", () => {
        // An outgoing jump is visible in the file being edited, so it is the edge the reader came for.
        const incoming = Array.from({ length: NEIGHBOUR_STATE_LIMIT }, (_, i) => inn("IN", i));

        expect(neighbourStates([out("OUT", 3)], incoming, "HELLO").load.get("OUT")).toEqual([3]);
    });
});
