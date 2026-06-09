import { describe, expect, it } from "vitest";
import type { ParseResult } from "@bgforge/binary";
import { buildModel, type Model } from "../src/model";
import { abilityEffectRefConstraint } from "../src/relationship/cross-record";

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
        const diags = abilityEffectRefConstraint(m);
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
        const diags = abilityEffectRefConstraint(m);
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
        expect(abilityEffectRefConstraint(m)).toHaveLength(0);
    });
});
