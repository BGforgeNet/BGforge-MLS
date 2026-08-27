import { describe, expect, it } from "vitest";
import { detachConfirmMessage, detachResultMessage } from "../src/dialog-editor/dlg-detach";

describe("detachConfirmMessage", () => {
    it("says how many replies here will be cut, and that the state itself stays", () => {
        const text = detachConfirmMessage({
            resref: "HELLO",
            stateIndex: 3,
            local: [
                { stateIndex: 0, choiceIndex: 1 },
                { stateIndex: 2, choiceIndex: 0 },
            ],
            external: [],
        });

        expect(text).toMatch(/state 3/i);
        expect(text).toMatch(/2 replies/i);
        // The honesty the whole feature turns on: this is a detachment, not a deletion.
        expect(text).toMatch(/remains in the file|stays in the file|not removed/i);
    });

    it("lists the other dialogs that will still reach the state", () => {
        const text = detachConfirmMessage({
            resref: "HELLO",
            stateIndex: 3,
            local: [],
            external: [
                { dialog: "OTHER", state: 1, transition: 0 },
                { dialog: "OTHER", state: 4, transition: 2 },
                { dialog: "THIRD", state: 0, transition: 0 },
            ],
        });

        expect(text).toMatch(/OTHER/);
        expect(text).toMatch(/THIRD/);
        // Two files, three replies - the count that matters to the reader is the files still reaching it.
        expect(text).toMatch(/still/i);
    });

    it("says the other dialogs were not checked when the index is not ready", () => {
        const text = detachConfirmMessage({ resref: "HELLO", stateIndex: 3, local: [], external: undefined });

        // An unchecked scan and a clean one must never read the same.
        expect(text).toMatch(/not .*(checked|finished)|still (being )?(built|scanned)/i);
        expect(text).not.toMatch(/no other dialog/i);
    });

    it("says plainly when nothing else reaches the state", () => {
        const text = detachConfirmMessage({ resref: "HELLO", stateIndex: 3, local: [], external: [] });

        expect(text).toMatch(/no other dialog/i);
    });

    it("names the exact reply in the other dialog, not just the file", () => {
        const text = detachConfirmMessage({
            resref: "ABELA",
            stateIndex: 0,
            local: [],
            external: [{ dialog: "RAGEFA", state: 12, transition: 3 }],
        });

        // Naming the file alone leaves the reader to hunt through it; the index already knows the site.
        expect(text).toMatch(/RAGEFA state 12, reply 4/);
    });

    it("numbers a reply in another dialog the same way as one in this dialog", () => {
        const text = detachConfirmMessage({
            resref: "ABELA",
            stateIndex: 0,
            local: [{ stateIndex: 5, choiceIndex: 3 }],
            external: [{ dialog: "RAGEFA", state: 5, transition: 3 }],
        });

        expect(text).toMatch(/state 5, reply 4/);
        expect(text).toMatch(/RAGEFA state 5, reply 4/);
    });

    it("groups the sites under each dialog in file order", () => {
        const text = detachConfirmMessage({
            resref: "ABELA",
            stateIndex: 0,
            local: [],
            external: [
                { dialog: "THIRD", state: 0, transition: 0 },
                { dialog: "OTHER", state: 4, transition: 2 },
                { dialog: "OTHER", state: 1, transition: 0 },
            ],
        });

        expect(text).toMatch(/OTHER state 1, reply 1; OTHER state 4, reply 3; THIRD state 0, reply 1/);
    });

    it("stops listing sites once there are too many to read, and says how many are left", () => {
        const external = Array.from({ length: 20 }, (_v, i) => ({
            dialog: `DLG${String(i).padStart(2, "0")}`,
            state: i,
            transition: 0,
        }));

        const text = detachConfirmMessage({ resref: "ABELA", stateIndex: 0, local: [], external });

        expect(text).toMatch(/20 replies/);
        expect(text).toMatch(/8 more/);
        // The head count still tells the reader the true scale, so the tail can be summarised.
        expect(text).not.toMatch(/DLG19/);
    });

    it("counts one reply in the singular", () => {
        const text = detachConfirmMessage({
            resref: "HELLO",
            stateIndex: 1,
            local: [{ stateIndex: 0, choiceIndex: 0 }],
            external: [],
        });

        expect(text).toMatch(/1 reply\b/i);
        expect(text).not.toMatch(/1 replies/i);
    });
});

describe("detachResultMessage", () => {
    it("names each reply that changed, by state and position", () => {
        const text = detachResultMessage(3, [
            { stateIndex: 0, choiceIndex: 1 },
            { stateIndex: 2, choiceIndex: 0 },
        ]);

        expect(text).toMatch(/state 0, reply 2/i);
        expect(text).toMatch(/state 2, reply 1/i);
    });

    it("reports a detach that cut nothing without implying replies changed", () => {
        const text = detachResultMessage(3, []);

        expect(text).toMatch(/no replies|nothing led/i);
    });
});
