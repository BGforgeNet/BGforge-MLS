/**
 * Host-side enforcement of the "editing-locked" guard.
 *
 * `editingLocked` on a ParsedGroup marks a partially-undecoded subtree (a MAP object whose subtype
 * trailer depends on external `.pro` metadata the parser couldn't resolve): field edits inside it are
 * width-preserving but not interpretation-preserving. Before this guard the lock was enforced ONLY by
 * the webview disabling its controls - the host write path (editField / structureOp / spellbookEdit)
 * performed no check of its own, so a crafted or raced message could mutate a locked subtree. These
 * tests exercise the shared predicate (`isNodeLocked` / `assertNotLocked` in `../src/model`) directly,
 * then each host entry point against REAL parsed fixtures: a representative unlocked edit/op per format
 * must still be ACCEPTED (the false-positive risk - a guard that rejects legitimate edits is worse than
 * no guard), and a genuinely locked target must be REJECTED with a thrown, catchable error rather than
 * silently dropped or applied.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ParsedField, ParsedGroup, ParseResult } from "@bgforge/binary";
import { openSession, sessionStore, type EditorSession } from "../src/session";
import { editField } from "../src/edit";
import { structureOp } from "../src/structure-ops";
import { spellbookEdit } from "../src/spellbook-ops";
import { assertNotLocked, buildModel, isNodeLocked, type FlatNode, type Model } from "../src/model";
import { findGroup } from "../src/relationship/model-helpers";

const REPO = path.resolve(__dirname, "../..");
const repo = (rel: string): string => path.join(REPO, rel);
const present = (file: string): boolean => fs.existsSync(file);

const MAP_FIXTURE = repo("client/testFixture/maps/arcaves.map");
const ITM_FIXTURE = repo("grammars/weidu-tp2/test/samples/core/items/misc8j.itm");
const PRO_FIXTURE = repo("client/testFixture/proto/items/00000031.pro");
const SPL_FIXTURE = repo("external/infinity-engine/bg2-wildmage/wildmage/wild_spells/spl/wm_word.spl");
const EFF_FIXTURE = repo("external/infinity-engine/Ascension/ascension/balthazar/resource/balth01b.eff");
const CRE_FIXTURE = repo("external/infinity-engine/BGT-WeiDU/bgt/modify/cre/edwin6.cre");

function openFixture(uri: string, file: string, options?: { pidResolver?: (pid: number) => number | undefined }) {
    const { sessionId } = openSession(uri, new Uint8Array(fs.readFileSync(file)), options);
    const session = sessionStore.get(sessionId);
    if (!session) throw new Error(`fixture did not open a session: ${file}`);
    return session;
}

/** First field in pre-order whose ancestor chain is unlocked, whose stored value is numeric, and whose
 *  type is genuinely user-editable (not padding/note) - a producer-agnostic "pick any legitimate edit
 *  target" helper so the same accept-path assertion runs against every format's real parser output. */
function firstEditableNumericField(model: Model): FlatNode {
    const node = model.nodes.find((n) => {
        if (n.kind !== "field" || n.parentLocked === true) return false;
        const field = n.source as ParsedField;
        return typeof field.value === "number" && field.type !== "padding" && field.type !== "note";
    });
    if (!node) throw new Error("no unlocked editable numeric field found in fixture");
    return node;
}

/** MAP fixture parsed with a resolver forced to fail, so the first Item/Scenery record bails with
 *  `editingLocked: true` on real bytes (mirrors binary/test/map-incomplete-object-marker.test.ts) -
 *  a genuine locked subtree from the real parser, not a hand-built one. */
function openLockedMapSession(): EditorSession {
    return openFixture("file:///locked.map", MAP_FIXTURE, { pidResolver: () => undefined });
}

/** Locates the locked object by the raw parser-set `editingLocked` flag on its `ParsedGroup` source, NOT
 *  via `isNodeLocked`/`assertNotLocked` - those are the functions under test here, so fixture selection
 *  must stay independent of them or a broken predicate could select a different (still-correct-looking)
 *  target and mask its own failure. */
function findLockedObjectGroup(session: EditorSession): FlatNode {
    const locked = session.model.nodes.find(
        (n) =>
            n.kind === "group" && /^Object \d+\.\d+ /.test(n.name) && (n.source as ParsedGroup).editingLocked === true,
    );
    if (!locked) throw new Error("expected the forced-unresolved-pid MAP fixture to contain a locked object");
    return locked;
}

describe("isNodeLocked / assertNotLocked predicate", () => {
    // A ParsedField/ParsedGroup structural subset (buildModel only reads `name`/`fields`/`editingLocked`
    // on groups and `value`/`type` on fields) - mirrors the cast convention in cross-record-fixture.ts.
    function syntheticResult(): ParseResult {
        return {
            format: "test",
            formatName: "Test Format",
            root: {
                name: "Root",
                fields: [
                    {
                        name: "LockedGroup",
                        editingLocked: true,
                        fields: [
                            { name: "LockedField", value: 1, offset: 0, size: 1, type: "uint8" },
                            {
                                name: "NestedGroup",
                                fields: [{ name: "NestedField", value: 2, offset: 1, size: 1, type: "uint8" }],
                            },
                        ],
                    },
                    {
                        name: "UnlockedGroup",
                        fields: [{ name: "UnlockedField", value: 3, offset: 2, size: 1, type: "uint8" }],
                    },
                ],
            },
        };
    }

    it("is true for the locked group itself, its direct field, and a doubly-nested descendant", () => {
        const model = buildModel(syntheticResult());
        const lockedGroup = model.nodes.find((n) => n.name === "LockedGroup")!;
        const lockedField = model.nodes.find((n) => n.name === "LockedField")!;
        const nestedGroup = model.nodes.find((n) => n.name === "NestedGroup")!;
        const nestedField = model.nodes.find((n) => n.name === "NestedField")!;
        expect(isNodeLocked(model, lockedGroup.id)).toBe(true);
        expect(isNodeLocked(model, lockedField.id)).toBe(true);
        expect(isNodeLocked(model, nestedGroup.id)).toBe(true);
        expect(isNodeLocked(model, nestedField.id)).toBe(true);
    });

    it("is false for an unrelated sibling subtree and for an unknown node id", () => {
        const model = buildModel(syntheticResult());
        const unlockedGroup = model.nodes.find((n) => n.name === "UnlockedGroup")!;
        const unlockedField = model.nodes.find((n) => n.name === "UnlockedField")!;
        expect(isNodeLocked(model, unlockedGroup.id)).toBe(false);
        expect(isNodeLocked(model, unlockedField.id)).toBe(false);
        expect(isNodeLocked(model, "not-a-real-id")).toBe(false);
    });

    it("assertNotLocked throws naming the node for a locked target and is silent for an unlocked one", () => {
        const model = buildModel(syntheticResult());
        const lockedField = model.nodes.find((n) => n.name === "LockedField")!;
        const unlockedField = model.nodes.find((n) => n.name === "UnlockedField")!;
        expect(() => assertNotLocked(model, lockedField.id)).toThrow(/LockedField/);
        expect(() => assertNotLocked(model, unlockedField.id)).not.toThrow();
    });
});

describe("editField: accepts a real unlocked edit per format", () => {
    it("MAP (arcaves.map)", () => {
        const session = openFixture("file:///arcaves.map", MAP_FIXTURE);
        const node = firstEditableNumericField(session.model);
        const next = (node.source as ParsedField).value === 5 ? 6 : 5;
        expect(() => editField(session, node.id, next)).not.toThrow();
        expect(session.dirty).toBe(true);
        expect((node.source as ParsedField).value).toBe(next);
    });

    it("ITM (misc8j.itm)", () => {
        const session = openFixture("file:///misc8j.itm", ITM_FIXTURE);
        const node = firstEditableNumericField(session.model);
        const next = (node.source as ParsedField).value === 5 ? 6 : 5;
        expect(() => editField(session, node.id, next)).not.toThrow();
        expect(session.dirty).toBe(true);
        expect((node.source as ParsedField).value).toBe(next);
    });

    it("PRO (00000031.pro)", () => {
        const session = openFixture("file:///00000031.pro", PRO_FIXTURE);
        const node = firstEditableNumericField(session.model);
        const next = (node.source as ParsedField).value === 5 ? 6 : 5;
        expect(() => editField(session, node.id, next)).not.toThrow();
        expect(session.dirty).toBe(true);
        expect((node.source as ParsedField).value).toBe(next);
    });

    it.skipIf(!present(SPL_FIXTURE))("SPL (wm_word.spl)", () => {
        const session = openFixture("file:///wm_word.spl", SPL_FIXTURE);
        const node = firstEditableNumericField(session.model);
        const next = (node.source as ParsedField).value === 5 ? 6 : 5;
        expect(() => editField(session, node.id, next)).not.toThrow();
        expect(session.dirty).toBe(true);
        expect((node.source as ParsedField).value).toBe(next);
    });

    it.skipIf(!present(EFF_FIXTURE))("EFF (balth01b.eff)", () => {
        const session = openFixture("file:///balth01b.eff", EFF_FIXTURE);
        const node = firstEditableNumericField(session.model);
        const next = (node.source as ParsedField).value === 5 ? 6 : 5;
        expect(() => editField(session, node.id, next)).not.toThrow();
        expect(session.dirty).toBe(true);
        expect((node.source as ParsedField).value).toBe(next);
    });

    it.skipIf(!present(CRE_FIXTURE))("CRE (edwin6.cre)", () => {
        const session = openFixture("file:///edwin6.cre", CRE_FIXTURE);
        const node = firstEditableNumericField(session.model);
        const next = (node.source as ParsedField).value === 5 ? 6 : 5;
        expect(() => editField(session, node.id, next)).not.toThrow();
        expect(session.dirty).toBe(true);
        expect((node.source as ParsedField).value).toBe(next);
    });
});

describe("editField: rejects a field inside a real locked MAP subtree", () => {
    it("throws a structured error and leaves the field value unchanged", () => {
        const session = openLockedMapSession();
        const lockedGroup = findLockedObjectGroup(session);
        const lockedField = session.model.nodes.find((n) => n.kind === "field" && n.parentId === lockedGroup.id);
        expect(lockedField, "locked object should still expose its already-decoded fields").toBeDefined();
        if (!lockedField) throw new Error("no field under the locked object");
        const before = (lockedField.source as ParsedField).value;

        expect(() => editField(session, lockedField.id, 999)).toThrow(/read-only/i);
        expect(session.dirty).toBe(false);
        expect((lockedField.source as ParsedField).value).toBe(before);
    });
});

describe("structureOp: accepts a real unlocked op per format", () => {
    it("MAP: add on Global Variables", () => {
        const session = openFixture("file:///arcaves.map", MAP_FIXTURE);
        const gv = session.model.nodes.find((n) => n.name === "Global Variables")!;
        const before = (session.model.childrenByParent.get(gv.id) ?? []).length;
        const result = structureOp(session, { op: "add", sectionId: gv.id });
        expect(result.changeSet.dirty).toBe(true);
        const gv2 = session.model.nodes.find((n) => n.name === "Global Variables")!;
        expect((session.model.childrenByParent.get(gv2.id) ?? []).length).toBe(before + 1);
    });

    it("ITM: add on Effects", () => {
        const session = openFixture("file:///misc8j.itm", ITM_FIXTURE);
        const effects = session.model.nodes.find((n) => n.kind === "group" && n.name === "Effects")!;
        const before = (session.model.childrenByParent.get(effects.id) ?? []).length;
        const result = structureOp(session, { op: "add", sectionId: effects.id });
        expect(result.changeSet.dirty).toBe(true);
        const effects2 = session.model.nodes.find((n) => n.kind === "group" && n.name === "Effects")!;
        expect((session.model.childrenByParent.get(effects2.id) ?? []).length).toBe(before + 1);
    });
});

describe("structureOp: rejects an op targeting a real locked MAP subtree", () => {
    it("remove on the locked object itself throws and leaves the collection unchanged", () => {
        const session = openLockedMapSession();
        const lockedGroup = findLockedObjectGroup(session);
        const parentId = lockedGroup.parentId;
        if (parentId === undefined) throw new Error("locked object should have a parent section");
        const before = (session.model.childrenByParent.get(parentId) ?? []).length;

        expect(() => structureOp(session, { op: "remove", entryId: lockedGroup.id })).toThrow(/read-only/i);
        expect(session.dirty).toBe(false);
        expect((session.model.childrenByParent.get(parentId) ?? []).length).toBe(before);
    });

    it("addChild (owner-scoped) targeting the locked object throws", () => {
        const session = openLockedMapSession();
        const lockedGroup = findLockedObjectGroup(session);
        expect(() =>
            structureOp(session, { op: "addChild", entryId: lockedGroup.id, childSection: "Inventory" }),
        ).toThrow(/read-only/i);
        expect(session.dirty).toBe(false);
    });
});

describe("spellbookEdit: rejects memorize onto a locked memorization-info owner", () => {
    // CRE's real parser never sets editingLocked (no corpus fixture can exercise a genuinely locked CRE
    // subtree today), so this proves the guard for the third host entry point with a minimal synthetic
    // model shaped like the real "Spell Memorization Info" section spellbookEdit reads - a structural
    // subset cast the same way cross-record-fixture.ts's creResult is, not a full CRE tree.
    function lockedMeminfoResult(): ParseResult {
        return {
            format: "cre",
            formatName: "CRE",
            root: {
                name: "CRE File",
                fields: [
                    {
                        name: "Spell Memorization Info",
                        fields: [
                            {
                                name: "Spell Memorization Info 1",
                                editingLocked: true,
                                fields: [
                                    { name: "First Memorized Spell Index", value: 0, rawValue: 0 },
                                    { name: "Memorized Spell Count", value: 0, rawValue: 0 },
                                ],
                            },
                        ],
                    },
                    { name: "Memorized Spells", fields: [] },
                ],
            },
        } as unknown as ParseResult;
    }

    it("throws instead of adding a memorized slot", () => {
        const model = buildModel(lockedMeminfoResult());
        const owner = findGroup(model, "Spell Memorization Info 1")!;
        const session: EditorSession = {
            id: "s-cre-locked-meminfo",
            uri: "file:///locked.cre",
            parserId: "cre",
            parseOptions: {},
            model,
            undo: [],
            redo: [],
            dirty: false,
        };
        expect(() => spellbookEdit(session, { op: "memorize", ownerNodeId: owner.id, resref: "TEST" })).toThrow(
            /read-only/i,
        );
        expect(session.dirty).toBe(false);
    });
});
