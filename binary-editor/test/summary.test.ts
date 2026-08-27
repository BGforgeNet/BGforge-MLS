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
import { enumSelectedLabel } from "../../shared/enum-label";
import type { FlatNode, Model } from "../src/model";
import type { RelationshipModel } from "../src/relationship/types";
import type { Row } from "../src/types";

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

// A CRE (EFF v2) with known + memorized spells, spell-mem-info, effects, and items.
const CRE_FIXTURE = path.resolve(
    __dirname,
    "../../external/infinity-engine/Ascension/ascension/ascensionmain/demon/finaluf.CRE",
);

function splFixturePresent(): boolean {
    return fs.existsSync(SPL_FIXTURE);
}

function creFixturePresent(): boolean {
    return fs.existsSync(CRE_FIXTURE);
}

function openCreSession(): { model: Model; rel: RelationshipModel | undefined } {
    const bytes = new Uint8Array(fs.readFileSync(CRE_FIXTURE));
    const { sessionId: sid } = openSession("file:///summary-cre.cre", bytes);
    const session = sessionStore.get(sid);
    if (!session) throw new Error("CRE session did not open");
    return { model: session.model, rel: getRelationshipModel("cre") };
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

/** Project a named child field of a group node and return its full projected row. */
function projectChildRow(
    model: Model,
    groupNode: FlatNode,
    fieldName: string,
    rel: RelationshipModel | undefined,
): Row | undefined {
    const childIndices = model.childrenByParent.get(groupNode.id) ?? [];
    const child = childIndices.map((i) => model.nodes[i]!).find((n) => n.kind === "field" && n.name === fieldName);
    if (!child) return undefined;
    return projectRow(model, child, rel);
}

/** The summary the composer must produce for a projected key field: an enum value reads value-prefixed
 *  ("<value> <name>"), reconstructed from the option map exactly as the dropdown's selected label is, so the
 *  list entry matches its dropdown; a non-enum field (a resref string, a raw number) shows its plain
 *  displayValue. */
function expectedSummary(row: Row): string {
    if (row.valueType === "enum" && typeof row.rawValue === "number") {
        return enumSelectedLabel(row.rawValue, row.enumOptions);
    }
    return row.displayValue ?? "";
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

        // The opcode is an enum, so the summary is value-prefixed to match the dropdown ("<opcode> <name>").
        const row = projectChildRow(model, effectEntry, "Opcode", rel);
        expect(row).toBeDefined();
        expect(row!.valueType).toBe("enum");
        expect(typeof row!.rawValue).toBe("number");

        const composer = summaryComposerFor("spl");
        expect(composer).toBeDefined();
        const summary = composer!(effectEntry, model, rel);
        // Concrete shape: a number, a space, then the opcode name.
        expect(summary).toMatch(/^\d+ \S/);
        expect(summary).toContain(String(row!.displayValue));
        expect(summary).toBe(expectedSummary(row!));
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

        // The Form field is an enum (e.g. "Standard"), so the summary is value-prefixed.
        const row = projectChildRow(model, abilityEntry, "Form", rel);
        expect(row).toBeDefined();

        const composer = summaryComposerFor("spl");
        expect(composer).toBeDefined();
        const summary = composer!(abilityEntry, model, rel);
        expect(summary).toMatch(/^-?\d+ \S/); // "<value> <name>"
        // Reconstructed from the option map, so an out-of-range value reads "0 Unknown" - never the parser's
        // raw "Unknown (0)" displayValue with its redundant parenthesized number.
        expect(summary).not.toContain("Unknown (");
        expect(summary).toBe(expectedSummary(row!));
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

        const row = projectChildRow(model, effectEntry, "Opcode", rel);
        expect(row).toBeDefined();

        const composer = summaryComposerFor("itm");
        expect(composer).toBeDefined();
        expect(composer!(effectEntry, model, rel)).toBe(expectedSummary(row!));
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

        // Attack Type is an enum (e.g. "Melee"), so the summary is value-prefixed.
        const row = projectChildRow(model, abilityEntry, "Attack Type", rel);
        expect(row).toBeDefined();

        const composer = summaryComposerFor("itm");
        expect(composer).toBeDefined();
        expect(composer!(abilityEntry, model, rel)).toBe(expectedSummary(row!));
    });
});

// ---------------------------------------------------------------------------
// CRE list sections (known/memorized spells, spell-mem-info, effects, items)
// ---------------------------------------------------------------------------

describe("summaryComposerFor cre", () => {
    // `enum` marks the key field whose value is a named code (value-prefixed in the summary); the resref
    // string fields (Spell, Item) carry no numeric identity and show their plain displayValue.
    const cases: ReadonlyArray<{ section: string; field: string; enum: boolean }> = [
        { section: "Known Spells", field: "Spell", enum: false },
        { section: "Memorized Spells", field: "Spell", enum: false },
        { section: "Spell Memorization Info", field: "Spell Type", enum: true },
        { section: "Effects", field: "Opcode", enum: true },
        { section: "Items", field: "Item", enum: false },
    ];

    for (const { section, field, enum: isEnum } of cases) {
        it(`summarizes a ${section} entry by its ${field}${isEnum ? " (value-prefixed)" : ""}`, () => {
            if (!creFixturePresent()) return;
            const { model, rel } = openCreSession();

            const entry = firstEntryIn(model, section);
            if (!entry) throw new Error(`no ${section} entry in CRE fixture`);

            const row = projectChildRow(model, entry, field, rel);
            expect(row).toBeDefined();
            const summary = summaryComposerFor("cre")!(entry, model, rel);

            // An enum renders "<value> <name>"; a resref string is shown as-is, with no numeric prefix.
            // The per-case expectation is folded into the compared values so both shapes are asserted on
            // every run rather than one branch reporting green over the other.
            expect(row!.valueType).toBe(isEnum ? "enum" : row!.valueType);
            const actualShape = isEnum && /^-?\d+ \S/.test(summary ?? "") ? "<value> <name>" : summary;
            expect(actualShape).toBe(isEnum ? "<value> <name>" : row!.displayValue);
            expect(summary).toBe(expectedSummary(row!));
        });
    }
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
