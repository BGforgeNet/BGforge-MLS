import { describe, expect, it } from "vitest";
import { parseDialog } from "../src/dialog";
import { modelFromSSL, type DialogModel } from "../../shared/dialog-model";
import { computeDialogSourceEdit } from "../../client/src/dialog-editor/dialog-source-edit";
import { addState, duplicateState } from "../../shared/dialog-edit-ops";
import { writeText } from "../../client/src/dialog-editor/webview/inspector-edit";

// End-to-end "what I see is what's saved" integrity guards for the dialogue editor: each scenario drives the
// FULL production edit pipeline (real parse -> model -> edit op -> computeDialogSourceEdit -> writer -> reparse)
// and asserts the on-disk source bytes agree with the intended view. These sit in the blocking gate (server
// unit run) as the anti-regression net for the silent "view != disk" bug class the black-box pass surfaced.
//
// The webview holds a working copy, emits it to the host on each mutation, the host splices it into the source
// and posts the faithful re-parse back, which the webview ADOPTS wholesale. `adopt` emulates that adopt step.
describe("dialogue editor view-vs-disk integrity round-trip", () => {
    /** The webview's adopt step: re-parse the just-spliced source, carrying the posted (typed) messages. */
    async function adopt(src: string, messages: Record<string, string>): Promise<DialogModel> {
        const adopted = modelFromSSL(await parseDialog(src));
        adopted.messages = { ...adopted.messages, ...messages };
        return adopted;
    }
    const stateOf = (m: DialogModel, id: string) => m.roots.flatMap((r) => r.states).find((s) => s.id === id);

    it("BUG A + replyless: +State on an existing dialogue creates a node you can then fill in, persisted", async () => {
        const SRC = `procedure Node001 begin\n    Reply(100);\nend\nprocedure talk_p_proc begin call Node001; end\n`;
        const original = modelFromSSL(await parseDialog(SRC));
        original.messages = { "100": "Hello, stranger." };

        // EMIT 1: the user clicks +State. addState mints an empty pending Node002.
        const edited1 = structuredClone(original);
        edited1.messages = { ...original.messages };
        const added = addState(edited1);
        expect(added.id).toBe("Node002");
        const edit1 = computeDialogSourceEdit(SRC, edited1, original);
        expect(edit1.newText).not.toBeNull();

        // ADOPT: the empty node must survive the reparse (it did not, pre-fix - it was an invisible disk orphan).
        const adopted = await adopt(edit1.newText!, edit1.messages);
        const node2 = stateOf(adopted, "Node002");
        expect(node2).toBeDefined();
        // It is a faithful reply-less node, so its NPC line is authorable (the +State NPC-line-lock fix).
        expect(node2!.replyless).toBe(true);

        // EMIT 2: the user types the NPC line on the now-adopted node.
        const edited2 = structuredClone(adopted);
        edited2.messages = { ...adopted.messages };
        const node2Edit = stateOf(edited2, "Node002")!;
        writeText(node2Edit, edited2.messages, "So we meet at last.");
        const edit2 = computeDialogSourceEdit(edit1.newText!, edited2, adopted);
        expect(edit2.newText).not.toBeNull();

        // The typed line is now backed by a freshly-allocated @N and spliced as `Reply(@N)`, round-tripping.
        const final = await adopt(edit2.newText!, edit2.messages);
        const finalNode2 = stateOf(final, "Node002")!;
        const ref = /^@(\d+)$/.exec(finalNode2.text.trim());
        expect(ref).not.toBeNull();
        expect(edit2.messages[ref![1]!]).toBe("So we meet at last.");
        // The original greeting is untouched.
        expect(edit2.messages["100"]).toBe("Hello, stranger.");
    });

    it("BUG C: duplicating a node and editing the copy leaves the original's on-disk string untouched", async () => {
        const SRC =
            `procedure Node001 begin\n    Reply(100);\n    NOption(101, Node002, 4);\nend\n` +
            `procedure Node002 begin\n    Reply(200);\nend\n` +
            `procedure talk_p_proc begin call Node001; end\n`;
        const original = modelFromSSL(await parseDialog(SRC));
        original.messages = { "100": "Greeting.", "101": "Ask about the map.", "200": "The map is old." };

        // The user duplicates Node002, then edits the COPY's NPC line.
        const edited = structuredClone(original);
        edited.messages = { ...original.messages };
        const copy = duplicateState(edited, stateOf(edited, "Node002")!)!;
        expect(copy.id).toBe("Node003");
        writeText(copy, edited.messages, "The map is a forgery."); // the edit that used to corrupt the original

        const edit = computeDialogSourceEdit(SRC, edited, original);
        expect(edit.newText).not.toBeNull();

        // The original Node002 still reads @200, and @200's string is UNCHANGED - the copy did not alias it.
        const reparsed = await adopt(edit.newText!, edit.messages);
        expect(stateOf(reparsed, "Node002")!.text.trim()).toBe("@200");
        expect(edit.messages["200"]).toBe("The map is old.");
        // The copy owns a NEW @N carrying the edited line (its own independent string).
        const copyRef = /^@(\d+)$/.exec(stateOf(reparsed, "Node003")!.text.trim());
        expect(copyRef).not.toBeNull();
        expect(copyRef![1]).not.toBe("200");
        expect(edit.messages[copyRef![1]!]).toBe("The map is a forgery.");
    });
});
