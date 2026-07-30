/**
 * Completeness sweep: a field whose documentation calls it a bonus, modifier or penalty must either be typed
 * SIGNED or be excluded here with the reason it cannot go negative.
 *
 * The IE half: IESDP has no signed integer at all - everything 32 bits wide is a `dword` - so the generator maps
 * every one to `u32` and a stored -4 surfaces as 4294967292. Nothing about the field's shape gives it away: a
 * signed field and an unsigned one are the same bytes and the same `codec:` line, and both round-trip
 * byte-identically, so the whole test suite stays green either way. The only signal is what IESDP CALLS it,
 * which is what this keys on.
 *
 * Static, over the specs rather than a corpus, and that is deliberate rather than lazy. The save bonus this
 * sweep was written for holds a negative in ~2,500 records of a real BG2/BG:EE install and in NONE of the
 * reproducible `external/` corpus - a corpus-gated check would have been green the whole time it was wrong.
 *
 * The discriminator is narrow on purpose: across every spec of both engine families it fires on 10 fields, of
 * which 7 are genuinely signed and 3 are excluded below. Widening it to every numeric field would mean an
 * exclusion list longer than the specs.
 */

import { describe, expect, it } from "vitest";
import { itmHeaderSpecAnnotated } from "../src/itm/specs/header.overrides";
import { itmAbilitySpecAnnotated } from "../src/itm/specs/ability.overrides";
import { splHeaderSpecAnnotated } from "../src/spl/specs/header.overrides";
import { splAbilitySpecAnnotated } from "../src/spl/specs/ability.overrides";
import { effBodySpecAnnotated } from "../src/eff/specs/body.overrides";
import { effectSpecAnnotated } from "../src/ie-common/specs/effect.overrides";
import { creHeaderSpecAnnotated } from "../src/cre/specs/header.overrides";
import { ammoSpec } from "../src/pro/specs/ammo";
import { armorSpec } from "../src/pro/specs/armor";
import { critterSpec } from "../src/pro/specs/critter";
import { drugSpec } from "../src/pro/specs/drug";
import { weaponSpec } from "../src/pro/specs/weapon";
import { itemCommonSpec } from "../src/pro/specs/item-common";
import { headerSpec } from "../src/pro/specs/header";
import type { FieldSpec } from "../src/spec/types";

/**
 * Every spec that can carry a numeric bonus, across BOTH engine families - the mis-typing follows from a
 * source's type vocabulary, not from any one game. IESDP has no signed integer at all; the Fallout specs are
 * hand-transcribed from the engine's own structs, where `long` IS signed and can be read past.
 *
 * CRE's and the Fallout specs are hand-written; the IE ones are generated.
 */
const SPECS: Record<string, Record<string, FieldSpec>> = {
    itmHeaderSpec: itmHeaderSpecAnnotated,
    itmAbilitySpec: itmAbilitySpecAnnotated,
    splHeaderSpec: splHeaderSpecAnnotated,
    splAbilitySpec: splAbilitySpecAnnotated,
    effBodySpec: effBodySpecAnnotated,
    effectSpec: effectSpecAnnotated,
    creHeaderSpec: creHeaderSpecAnnotated,
    proHeaderSpec: headerSpec,
    proAmmoSpec: ammoSpec,
    proArmorSpec: armorSpec,
    proCritterSpec: critterSpec,
    proDrugSpec: drugSpec,
    proWeaponSpec: weaponSpec,
    proItemCommonSpec: itemCommonSpec,
};

/**
 * Fields the discriminator flags that genuinely cannot go negative, with the measurement behind each. Every
 * count is over both installs; a field that never stores a negative in ~3,000 real records is not signed.
 */
const CANNOT_BE_NEGATIVE: Record<string, string> = {
    "creHeaderSpec.strengthBonus": "Exceptional-strength percentile, 0-100; corpus max is 100 over 6,273 CREs",
    "itmHeaderSpec.minStrengthBonus": "IESDP marks it unused in BG1; every one of 4,010 items stores 0",
    "itmAbilitySpec.alternativeDamageBonus": "Every one of 2,914 abilities stores 0 - no evidence it is used",
};

/** What a source calls a field when the value can be a penalty as well as a gain. */
const BONUS_WORD = /bonus|modifier|penalty|adjust/i;

/** typed-binary exposes its schemas by constructor name; the signed ones start with `Int`. */
function isSigned(spec: FieldSpec): boolean {
    const codec = (spec as { codec?: { constructor?: { name?: string } } }).codec;
    return codec?.constructor?.name?.startsWith("Int") === true;
}

function isNumeric(spec: FieldSpec): boolean {
    const name = (spec as { codec?: { constructor?: { name?: string } } }).codec?.constructor?.name;
    return name !== undefined && (name.startsWith("Int") || name.startsWith("Uint"));
}

describe("a field documented as a bonus is typed signed", () => {
    it("leaves no bonus-shaped field unsigned and unexplained", () => {
        const unsigned: string[] = [];
        for (const [specName, spec] of Object.entries(SPECS)) {
            for (const [field, fieldSpec] of Object.entries(spec)) {
                const key = `${specName}.${field}`;
                if (key in CANNOT_BE_NEGATIVE || !isNumeric(fieldSpec)) continue;
                const description = (fieldSpec as { description?: string }).description ?? "";
                if (!BONUS_WORD.test(field) && !BONUS_WORD.test(description)) continue;
                if (!isSigned(fieldSpec)) unsigned.push(key);
            }
        }

        expect(unsigned).toEqual([]);
    });

    // An exclusion list nobody prunes becomes where the next signed field hides. Each entry has to still name
    // a field the discriminator would otherwise flag - one that has since been typed signed no longer belongs.
    it("keeps no stale entry in the cannot-be-negative list", () => {
        const stale: string[] = [];
        for (const key of Object.keys(CANNOT_BE_NEGATIVE)) {
            const lastDot = key.lastIndexOf(".");
            const fieldSpec = SPECS[key.slice(0, lastDot)]?.[key.slice(lastDot + 1)];
            if (fieldSpec === undefined) stale.push(`${key}: no such field`);
            else if (isSigned(fieldSpec)) stale.push(`${key}: now typed signed, so it no longer belongs here`);
        }

        expect(stale).toEqual([]);
    });

    // The fields this sweep exists for. Pinned by value rather than left implicit, because the codec is the
    // ONLY thing that distinguishes a save penalty from a four-billion save bonus and no round-trip can tell.
    it.each([
        ["effectSpec", "saveBonus"],
        ["effBodySpec", "saveBonus"],
        ["itmAbilitySpec", "damageBonus"],
        ["itmAbilitySpec", "thac0Bonus"],
        ["creHeaderSpec", "thac0"],
        // Fallout: armour-piercing ammo lowers AC and DR, and the engine struct types both signed.
        ["proAmmoSpec", "acModifier"],
        ["proAmmoSpec", "drModifier"],
    ])("%s.%s is signed", (specName, field) => {
        expect(isSigned(SPECS[specName]![field]!)).toBe(true);
    });
});
