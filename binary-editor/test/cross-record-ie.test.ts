import { describe, expect, it } from "vitest";
import { formatAdapterRegistry, type ParseResult, type SliceRefRelationship } from "@bgforge/binary";
import { buildModel, type Model } from "../src/model";
import { sliceRefDiagnostics, orphanSliceDiagnostics } from "../src/relationship/cross-record";
import { openItmSession, itmFixturePresent, setRaw } from "./ie-fixture";
import { normKey } from "../src/relationship/model-helpers";

// The real ITM/SPL slice descriptors (single source of truth, declared on each adapter in @bgforge/binary).
const sliceRel = (fmt: "itm" | "spl") =>
    formatAdapterRegistry.get(fmt)!.crossRefRelationships!.find((r) => r.kind === "slice") as SliceRefRelationship;
const itmSliceRel = sliceRel("itm");
const splSliceRel = sliceRel("spl");

interface IeOpts {
    label: "ITM" | "SPL";
    effects: number;
    abilities: { start: number; count: number }[];
    equipping?: { start: number; count: number };
}

const f = (name: string, value: number) => ({ name, value, rawValue: value });
const g = (name: string, fields: unknown[]) => ({ name, fields });

/** Build a synthetic ITM/SPL ParseResult with the faithful labels and per-format field names.
 *  Cast to ParseResult: structural subset (buildModel reads `format` and `root.fields`); the adapter
 *  declares no hide/projection hooks, so projection is identity. */
function ieResult(o: IeOpts): ParseResult {
    const itm = o.label === "ITM";
    const aStart = itm ? "Feature Block Index" : "Feature Blocks Offset";
    const aCount = itm ? "Feature Block Count" : "Feature Blocks Count";
    const hStart = itm ? "Feature Blocks Index" : "Casting Feature Blocks Index";
    const hCount = itm ? "Feature Blocks Count" : "Casting Feature Blocks Count";
    const header = o.equipping ? [f(hStart, o.equipping.start), f(hCount, o.equipping.count)] : [];
    return {
        format: o.label.toLowerCase(),
        formatName: o.label,
        root: g(`${o.label} File`, [
            g(`${o.label} Header`, header),
            g(
                "Abilities",
                o.abilities.map((a, i) => g(`Ability ${i + 1}`, [f(aStart, a.start), f(aCount, a.count)])),
            ),
            g(
                "Effects",
                Array.from({ length: o.effects }, (_, i) => g(`Effect ${i + 1}`, [f("Opcode", 0)])),
            ),
        ]),
    } as unknown as ParseResult;
}

/** The count field node of the Nth ability (matches either ITM/SPL count label). */
function abilityCountNode(m: Model, abilityIndex: number): { id: string } {
    const abil = m.nodes.find((n) => n.kind === "group" && n.name === "Abilities")!;
    const ab = (m.childrenByParent.get(abil.id) ?? []).map((i) => m.nodes[i]!).filter((n) => n.kind === "group")[
        abilityIndex
    ]!;
    return (m.childrenByParent.get(ab.id) ?? []).map((i) => m.nodes[i]!).find((n) => /count/i.test(n.name))!;
}

describe("abilityEffectRefConstraint", () => {
    it("ITM: warns + clamps an ability slice that overshoots the effects table", () => {
        // 4 effects; ability 0 claims [2, 2+5) -> end 7 > 4.
        const m = buildModel(ieResult({ label: "ITM", effects: 4, abilities: [{ start: 2, count: 5 }] }));
        const diags = sliceRefDiagnostics(m, itmSliceRel);
        expect(diags).toHaveLength(1);
        const node = abilityCountNode(m, 0);
        expect(diags[0]!.nodeId).toBe(node.id);
        expect(diags[0]!.severity).toBe("warning");
        expect(diags[0]!.quickFix?.edits).toEqual([{ nodeId: node.id, value: 2 }]); // max(0, 4 - 2)
    });
    it("SPL: handles the plural field names and the casting header range", () => {
        // 2 effects; casting header range [0, 0+9) overshoots.
        const m = buildModel(
            ieResult({
                label: "SPL",
                effects: 2,
                abilities: [{ start: 0, count: 2 }],
                equipping: { start: 0, count: 9 },
            }),
        );
        const diags = sliceRefDiagnostics(m, splSliceRel);
        expect(diags.some((d) => d.message.includes("[0, 9)"))).toBe(true);
    });
    it("no diagnostic when all ranges fit", () => {
        const m = buildModel(
            ieResult({
                label: "ITM",
                effects: 5,
                abilities: [
                    { start: 0, count: 2 },
                    { start: 2, count: 3 },
                ],
            }),
        );
        expect(sliceRefDiagnostics(m, itmSliceRel)).toHaveLength(0);
    });
});

describe("orphanEffectsConstraint", () => {
    it("notes effects covered by no range", () => {
        // 4 effects; ability covers [0,2); nothing else -> effects #2,#3 orphaned.
        const m = buildModel(ieResult({ label: "ITM", effects: 4, abilities: [{ start: 0, count: 2 }] }));
        const diags = orphanSliceDiagnostics(m, itmSliceRel);
        expect(diags).toHaveLength(1);
        expect(diags[0]!.severity).toBe("info");
        expect(diags[0]!.message).toContain("2 unreferenced");
        expect(diags[0]!.message).toContain("#2");
        expect(diags[0]!.message).toContain("#3");
        const eff = m.nodes.find((n) => n.kind === "group" && n.name === "Effects")!;
        expect(diags[0]!.nodeId).toBe(eff.id);
    });
    it("no note when ability + header ranges cover every effect", () => {
        const m = buildModel(
            ieResult({
                label: "ITM",
                effects: 3,
                abilities: [{ start: 0, count: 2 }],
                equipping: { start: 2, count: 1 },
            }),
        );
        expect(orphanSliceDiagnostics(m, itmSliceRel)).toHaveLength(0);
    });
});

// Real-producer guard: the synthetic builders above encode assumed humanized labels. This drives the actual ITM
// parser on a vendored fixture so a label/shape drift (e.g. "Feature Blocks Count" renamed) fails loudly instead
// of passing against a wrong assumption. The vendored misc8j.itm has zero abilities and 5 equipping effects, so
// it exercises the header equipping range (Feature Blocks Index/Count) and the Effects list; ability-entry labels
// stay synthetic-only as no vendored fixture carries abilities. Skips when the fixture is absent.
describe("ITM/SPL checks against the real ITM parser", () => {
    it("matches the real header/effects labels and drives both checks via the equipping range", () => {
        if (!itmFixturePresent()) return;
        const model = openItmSession().model;
        const header = model.nodes.find((n) => n.kind === "group" && n.name === "ITM Header");
        const effects = model.nodes.find((n) => n.kind === "group" && n.name === "Effects");
        expect(
            model.nodes.some((n) => n.kind === "group" && n.name === "Abilities"),
            "Abilities group",
        ).toBe(true);
        expect(header, "real ITM exposes an ITM Header group").toBeDefined();
        expect(effects, "real ITM exposes an Effects group").toBeDefined();
        const countNode = (model.childrenByParent.get(header!.id) ?? [])
            .map((i) => model.nodes[i]!)
            .find((n) => n.kind === "field" && normKey(n.name) === "featureblockscount");
        expect(countNode, "real ITM header exposes a Feature Blocks Count field").toBeDefined();

        // Clean fixture: index 0 + count 5 over 5 effects -> consistent, fully covered.
        expect(sliceRefDiagnostics(model, itmSliceRel)).toHaveLength(0);
        expect(orphanSliceDiagnostics(model, itmSliceRel)).toHaveLength(0);

        // Shrink the equipping range -> the now-uncovered effects surface as an orphan info note.
        setRaw(countNode!, 2);
        const orphans = orphanSliceDiagnostics(model, itmSliceRel);
        expect(orphans).toHaveLength(1);
        expect(orphans[0]!.severity).toBe("info");
        expect(orphans[0]!.message).toContain("unreferenced");
        expect(sliceRefDiagnostics(model, itmSliceRel)).toHaveLength(0); // 2 <= 5 still fits

        // Overshoot the equipping range -> a broken-ref warning fires on that exact field node.
        setRaw(countNode!, 9999);
        const broken = sliceRefDiagnostics(model, itmSliceRel);
        expect(broken.some((d) => d.nodeId === countNode!.id && d.severity === "warning")).toBe(true);
    });
});
