import { describe, expect, test } from "vitest";
import { abilityEffectsSemanticFieldKey } from "../src/ie-common/semantic-keys";

/**
 * The ITM/SPL semantic-key mapping must give an ability's nested SLOT-ARRAY leaves DISTINCT keys, so a
 * master-detail detail pane (which builds a flat per-entry `FieldRef -> Row` map) can reference each slot
 * individually. The ITM ability `Melee Animation` group has three slots (Overhand/Backhand/Thrust); without
 * the leaf segment they all collapse to `itm.abilities[].meleeAnimation` and two of three would be lost.
 */
describe("abilityEffectsSemanticFieldKey", () => {
    test("a flat ability leaf keys to abilities[].<field>", () => {
        expect(abilityEffectsSemanticFieldKey("itm", "ITM Header", ["Abilities", "Ability 1", "Attack Type"])).toBe(
            "itm.abilities[].attackType",
        );
    });

    test("nested ability slot leaves get distinct keys (not collapsed to the group)", () => {
        const base = ["Abilities", "Ability 1", "Melee Animation"];
        const overhand = abilityEffectsSemanticFieldKey("itm", "ITM Header", [...base, "Overhand"]);
        const backhand = abilityEffectsSemanticFieldKey("itm", "ITM Header", [...base, "Backhand"]);
        const thrust = abilityEffectsSemanticFieldKey("itm", "ITM Header", [...base, "Thrust"]);
        expect(overhand).toBe("itm.abilities[].meleeAnimation.overhand");
        expect(backhand).toBe("itm.abilities[].meleeAnimation.backhand");
        expect(thrust).toBe("itm.abilities[].meleeAnimation.thrust");
        expect(new Set([overhand, backhand, thrust]).size).toBe(3);
    });

    test("effect leaves are unaffected (flat, three-segment)", () => {
        expect(abilityEffectsSemanticFieldKey("spl", "SPL Header", ["Effects", "Effect 1", "Opcode"])).toBe(
            "spl.effects[].opcode",
        );
    });
});
