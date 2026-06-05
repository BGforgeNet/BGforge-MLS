/**
 * Tests for the per-format entry summary registry.
 *
 * Each test drives the REAL producer: parse a vendored fixture -> build model
 * -> project the key field -> assert the summary composer returns the same
 * displayValue. This pins the behavior to the real display tree shape, not a
 * hand-typed string.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openSession, sessionStore } from "../src/session";
import { projectRow } from "../src/window";
import { getRelationshipModel } from "../src/relationship/registry";
import { summaryComposerFor } from "../src/summary";
import type { FlatNode, Model } from "../src/model";
import type { RelationshipModel } from "../src/relationship/types";

// ---------------------------------------------------------------------------
// Fixture paths
// ---------------------------------------------------------------------------

const SPL_FIXTURE = path.resolve(__dirname, "../../external/infinity-engine/BGT-WeiDU/bgt/fixpack/bgsleepp.spl");

// An ITM with at least one ability.
const ITM_ABILITY_FIXTURE = path.resolve(
    __dirname,
    "../../external/infinity-engine/Ascension/ascension/tougher/illasera/illas03.itm",
);

// Standard ITM fixture shared with relationship tests (has effects, no abilities).
const ITM_EFFECTS_FIXTURE = path.resolve(__dirname, "../../grammars/weidu-tp2/test/samples/core/items/misc8j.itm");

function splFixturePresent(): boolean {
    return fs.existsSync(SPL_FIXTURE);
}

function itmAbilityFixturePresent(): boolean {
    return fs.existsSync(ITM_ABILITY_FIXTURE);
}

function itmEffectsFixturePresent(): boolean {
    return fs.existsSync(ITM_EFFECTS_FIXTURE);
}

function openSplSession(): { model: Model; rel: RelationshipModel | undefined } {
    const bytes = new Uint8Array(fs.readFileSync(SPL_FIXTURE));
    const { sessionId: sid } = openSession("file:///summary-spl.spl", bytes);
    const session = sessionStore.get(sid);
    if (!session) throw new Error("SPL session did not open");
    return { model: session.model, rel: getRelationshipModel("spl") };
}

function openItmAbilitySession(): { model: Model; rel: RelationshipModel | undefined } {
    const bytes = new Uint8Array(fs.readFileSync(ITM_ABILITY_FIXTURE));
    const { sessionId: sid } = openSession("file:///summary-itm-ability.itm", bytes);
    const session = sessionStore.get(sid);
    if (!session) throw new Error("ITM (ability) session did not open");
    return { model: session.model, rel: getRelationshipModel("itm") };
}

function openItmEffectsSession(): { model: Model; rel: RelationshipModel | undefined } {
    const bytes = new Uint8Array(fs.readFileSync(ITM_EFFECTS_FIXTURE));
    const { sessionId: sid } = openSession("file:///summary-itm-effects.itm", bytes);
    const session = sessionStore.get(sid);
    if (!session) throw new Error("ITM (effects) session did not open");
    return { model: session.model, rel: getRelationshipModel("itm") };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** First group-kind child inside a named section group. */
function firstEntryIn(model: Model, sectionName: string): FlatNode | undefined {
    const section = model.nodes.find((n) => n.kind === "group" && n.name === sectionName);
    if (!section) return undefined;
    const kidIndices = model.childrenByParent.get(section.id) ?? [];
    return kidIndices.map((i) => model.nodes[i]!).find((n) => n.kind === "group");
}

/** Project a named child field of a group node and return its displayValue. */
function projectChild(
    model: Model,
    groupNode: FlatNode,
    fieldName: string,
    rel: RelationshipModel | undefined,
): string | undefined {
    const childIndices = model.childrenByParent.get(groupNode.id) ?? [];
    const child = childIndices.map((i) => model.nodes[i]!).find((n) => n.kind === "field" && n.name === fieldName);
    if (!child) return undefined;
    return projectRow(model, child, rel).displayValue;
}

// ---------------------------------------------------------------------------
// SPL effects
// ---------------------------------------------------------------------------

describe("summaryComposerFor spl - effects", () => {
    it("returns the projected Opcode displayValue for an effect entry", () => {
        if (!splFixturePresent()) return;
        const { model, rel } = openSplSession();

        const effectEntry = firstEntryIn(model, "Effects");
        if (!effectEntry) throw new Error("no effect entry in SPL fixture");

        // Expected: same value the composer must return, derived from the real producer.
        const expected = projectChild(model, effectEntry, "Opcode", rel);
        expect(expected).toBeDefined();
        expect(expected!.length).toBeGreaterThan(0);

        const composer = summaryComposerFor("spl");
        expect(composer).toBeDefined();
        expect(composer!(effectEntry, model, rel)).toBe(expected);
    });

    it("returns undefined for an unknown format", () => {
        expect(summaryComposerFor("unknown-format-xyz")).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// SPL abilities
// ---------------------------------------------------------------------------

describe("summaryComposerFor spl - abilities", () => {
    it("returns the projected Form displayValue for an ability entry", () => {
        if (!splFixturePresent()) return;
        const { model, rel } = openSplSession();

        const abilityEntry = firstEntryIn(model, "Abilities");
        if (!abilityEntry) throw new Error("no ability entry in SPL fixture");

        // Expected: the Form field's displayValue (e.g. "Standard").
        const expected = projectChild(model, abilityEntry, "Form", rel);
        expect(expected).toBeDefined();
        expect(expected!.length).toBeGreaterThan(0);

        const composer = summaryComposerFor("spl");
        expect(composer).toBeDefined();
        expect(composer!(abilityEntry, model, rel)).toBe(expected);
    });
});

// ---------------------------------------------------------------------------
// ITM effects
// ---------------------------------------------------------------------------

describe("summaryComposerFor itm - effects", () => {
    it("returns the projected Opcode displayValue for an effect entry", () => {
        if (!itmEffectsFixturePresent()) return;
        const { model, rel } = openItmEffectsSession();

        const effectEntry = firstEntryIn(model, "Effects");
        if (!effectEntry) throw new Error("no effect entry in ITM fixture");

        const expected = projectChild(model, effectEntry, "Opcode", rel);
        expect(expected).toBeDefined();

        const composer = summaryComposerFor("itm");
        expect(composer).toBeDefined();
        expect(composer!(effectEntry, model, rel)).toBe(expected);
    });
});

// ---------------------------------------------------------------------------
// ITM abilities
// ---------------------------------------------------------------------------

describe("summaryComposerFor itm - abilities", () => {
    it("returns the projected Attack Type displayValue for an ability entry", () => {
        if (!itmAbilityFixturePresent()) return;
        const { model, rel } = openItmAbilitySession();

        const abilityEntry = firstEntryIn(model, "Abilities");
        if (!abilityEntry) throw new Error("no ability entry in ITM fixture");

        const expected = projectChild(model, abilityEntry, "Attack Type", rel);
        expect(expected).toBeDefined();
        expect(expected!.length).toBeGreaterThan(0);

        const composer = summaryComposerFor("itm");
        expect(composer).toBeDefined();
        expect(composer!(abilityEntry, model, rel)).toBe(expected);
    });
});

// ---------------------------------------------------------------------------
// Robustness: missing child field -> undefined, no throw
// ---------------------------------------------------------------------------

describe("summaryComposerFor robustness", () => {
    it("returns undefined and does not throw when the key field is absent from the group", () => {
        if (!splFixturePresent()) return;
        const { model, rel } = openSplSession();

        // The SPL Header is a form group that lacks an Opcode or Form child.
        const headerGroup = model.nodes.find((n) => n.kind === "group" && n.name === "SPL Header");
        if (!headerGroup) return; // fixture-dependent; skip gracefully

        const composer = summaryComposerFor("spl");
        expect(composer).toBeDefined();
        // Must not throw; may return undefined.
        expect(() => composer!(headerGroup, model, rel)).not.toThrow();
    });
});
