/**
 * Editor-session integration for CRE structure ops: open a real CRE fixture,
 * drive each section's ops through the session -> structureOp -> cre adapter
 * -> ops -> model-rebuild path (the same path the webview triggers), and
 * confirm collection sizes change and undo restores. The binary package tests
 * cover the byte-builders; this pins the editor wiring.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openSession, sessionStore, type EditorSession } from "../src/session";
import { structureOp, undo } from "../src/structure-ops";

// finaluf.CRE: EFF v2, with known + memorized spells, spell-mem-info, effects, items.
const CRE_FIXTURE = path.resolve(
    __dirname,
    "../../external/infinity-engine/Ascension/ascension/ascensionmain/demon/finaluf.CRE",
);

const present = fs.existsSync(CRE_FIXTURE);

function open(): EditorSession {
    const { sessionId } = openSession("file:///finaluf.cre", new Uint8Array(fs.readFileSync(CRE_FIXTURE)));
    const session = sessionStore.get(sessionId);
    if (!session) throw new Error("no session");
    return session;
}

function sectionCount(session: EditorSession, sectionName: string): number {
    const node = session.model.nodes.find((n) => n.kind === "group" && n.name === sectionName);
    if (!node) throw new Error(`no section "${sectionName}"`);
    return (session.model.childrenByParent.get(node.id) ?? []).length;
}

function sectionId(session: EditorSession, sectionName: string): string {
    const node = session.model.nodes.find((n) => n.kind === "group" && n.name === sectionName);
    if (!node) throw new Error(`no section "${sectionName}"`);
    return node.id;
}
function firstEntryId(session: EditorSession, sectionName: string): string {
    const node = session.model.nodes.find((n) => n.kind === "group" && n.name === sectionName)!;
    const kids = session.model.childrenByParent.get(node.id) ?? [];
    const first = kids.map((i) => session.model.nodes[i]!).find((n) => n.kind === "group");
    if (!first) throw new Error(`no entry in "${sectionName}"`);
    return first.id;
}

const maybe = present ? describe : describe.skip;

maybe("CRE editor structure ops", () => {
    it("renders the five list sections as master-detail with the right caps", () => {
        const { layout } = openSession("file:///finaluf-caps.cre", new Uint8Array(fs.readFileSync(CRE_FIXTURE)));
        const resolved = layout.layout;
        expect(resolved?.variantId).toBe("creature");
        // Render mode is declared on the `list` block; structure-op caps live in the resolved sections map.
        const listBlocks = new Map<string, "inline" | "master-detail">();
        const rows =
            resolved?.rows ??
            (resolved?.tabs ?? []).flatMap((t) => t.rows ?? (t.tabs ?? []).flatMap((st) => st.rows ?? []));
        for (const row of rows) {
            for (const panel of row.panels) {
                for (const block of panel.blocks) {
                    if (block.kind === "list") listBlocks.set(block.sectionKey, block.render);
                }
            }
        }
        for (const name of ["Known Spells", "Spell Memorization Info", "Memorized Spells", "Effects", "Items"]) {
            expect(listBlocks.get(name)).toBe("master-detail");
            expect(resolved?.sections[name]?.canModify).toBe(true);
        }
        // Memorized spells are owner-ambiguous: no section-level add.
        expect(resolved?.sections["Memorized Spells"]?.canAdd).toBe(false);
        expect(resolved?.sections["Spell Memorization Info"]?.canAdd).toBe(true);
        expect(resolved?.sections["Items"]?.canAdd).toBe(true);
        // Item Slots is a grid of fixed slots, not a list section - absent from the list-section map.
        expect(resolved?.sections["Item Slots"]).toBeUndefined();
    });

    it("adds and removes a known spell (flat)", () => {
        const session = open();
        const before = sectionCount(session, "Known Spells");
        const r = structureOp(session, { op: "add", sectionId: sectionId(session, "Known Spells") });
        expect(r.changeSet.dirty).toBe(true);
        expect(sectionCount(session, "Known Spells")).toBe(before + 1);
        undo(session);
        expect(sectionCount(session, "Known Spells")).toBe(before);
    });

    it("adds an empty memorization entry (owner), no memorized-spell change", () => {
        const session = open();
        const ownersBefore = sectionCount(session, "Spell Memorization Info");
        const slicesBefore = sectionCount(session, "Memorized Spells");
        structureOp(session, { op: "add", sectionId: sectionId(session, "Spell Memorization Info") });
        expect(sectionCount(session, "Spell Memorization Info")).toBe(ownersBefore + 1);
        expect(sectionCount(session, "Memorized Spells")).toBe(slicesBefore); // slices unchanged
    });

    it("inserts and removes a memorized spell (slice, owner-relative)", () => {
        const session = open();
        const before = sectionCount(session, "Memorized Spells");
        const target = firstEntryId(session, "Memorized Spells");
        const ins = structureOp(session, {
            op: "insert",
            entryId: target,
            position: "after",
        });
        expect(ins.changeSet.dirty).toBe(true);
        expect(sectionCount(session, "Memorized Spells")).toBe(before + 1);
        undo(session);
        expect(sectionCount(session, "Memorized Spells")).toBe(before);

        const rem = structureOp(session, { op: "remove", entryId: firstEntryId(session, "Memorized Spells") });
        expect(rem.changeSet.dirty).toBe(true);
        expect(sectionCount(session, "Memorized Spells")).toBe(before - 1);
    });

    it("rejects a section-level add on memorized spells (owner-ambiguous)", () => {
        const session = open();
        const before = sectionCount(session, "Memorized Spells");
        const r = structureOp(session, { op: "add", sectionId: sectionId(session, "Memorized Spells") });
        expect(r.changeSet.dirty).toBe(false);
        expect(sectionCount(session, "Memorized Spells")).toBe(before);
    });

    it("adds a v2 effect (flat)", () => {
        const session = open();
        const before = sectionCount(session, "Effects");
        structureOp(session, { op: "add", sectionId: sectionId(session, "Effects") });
        expect(sectionCount(session, "Effects")).toBe(before + 1);
    });

    it("adds, duplicates, and removes an item (flat + itemSlots relink)", () => {
        const session = open();
        const before = sectionCount(session, "Items");
        structureOp(session, { op: "add", sectionId: sectionId(session, "Items") });
        expect(sectionCount(session, "Items")).toBe(before + 1);
        structureOp(session, { op: "duplicate", entryId: firstEntryId(session, "Items") });
        expect(sectionCount(session, "Items")).toBe(before + 2);
        structureOp(session, { op: "remove", entryId: firstEntryId(session, "Items") });
        expect(sectionCount(session, "Items")).toBe(before + 1);
    });
});
