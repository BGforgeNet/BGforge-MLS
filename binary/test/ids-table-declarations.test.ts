/**
 * Completeness sweep: a field whose documentation names an IDS or 2DA table must either DECLARE that table
 * (`ref: { kind: "ids" | "2da" }`) or be explicitly excluded here with the reason it names one without
 * indexing it.
 *
 * The resref sweep in `external-refs.test.ts` has a structural discriminator to work from - a resref is a
 * `char[8]`, so a bare one is visible. An IDS-backed field has none: it is a plain number, indistinguishable
 * from any other number, so a field that should name its table can sit bare forever and nothing notices. The
 * IESDP-derived `description` is the only signal, which is what this keys on.
 *
 * Static, over the specs themselves rather than a parsed fixture: a fixture only reaches the fields its own
 * record happens to carry, and the point is to cover every declared field.
 */

import { describe, expect, it } from "vitest";
import { itmHeaderSpecAnnotated } from "../src/itm/specs/header.overrides";
import { itmAbilitySpecAnnotated } from "../src/itm/specs/ability.overrides";
import { splHeaderSpecAnnotated } from "../src/spl/specs/header.overrides";
import { splAbilitySpecAnnotated } from "../src/spl/specs/ability.overrides";
import { effBodySpecAnnotated } from "../src/eff/specs/body.overrides";
import { effectSpecAnnotated } from "../src/ie-common/specs/effect.overrides";
import { creHeaderSpecAnnotated } from "../src/cre/specs/header.overrides";
import { creItemSpecAnnotated } from "../src/cre/specs/item.overrides";
import { creKnownSpellSpecAnnotated } from "../src/cre/specs/known-spell.overrides";
import { creMemorizedSpellSpecAnnotated } from "../src/cre/specs/memorized-spell.overrides";
import { creSpellMemInfoSpecAnnotated } from "../src/cre/specs/spell-mem-info.overrides";

/** Every annotated spec, by the name this test reports a field under. */
const SPECS: Readonly<Record<string, unknown>> = {
    itmHeader: itmHeaderSpecAnnotated,
    itmAbility: itmAbilitySpecAnnotated,
    splHeader: splHeaderSpecAnnotated,
    splAbility: splAbilitySpecAnnotated,
    effBody: effBodySpecAnnotated,
    featureBlock: effectSpecAnnotated,
    creHeader: creHeaderSpecAnnotated,
    creItem: creItemSpecAnnotated,
    creKnownSpell: creKnownSpellSpecAnnotated,
    creMemorizedSpell: creMemorizedSpellSpecAnnotated,
    creSpellMemInfo: creSpellMemInfoSpecAnnotated,
};

/**
 * Fields that name a table in their documentation but correctly declare none. Each needs a reason: an entry
 * here is a recorded decision, and without one a bare field is indistinguishable from an oversight - which is
 * the whole thing this sweep exists to prevent.
 */
const NAMES_A_TABLE_BUT_INDEXES_NONE: Readonly<Record<string, string>> = {
    "itmAbility.projectileType":
        "Stores the launcher category the ability requires (0 None, 1 Bow, ...), not an ITEMCAT.IDS key. The " +
        "description names ITEMCAT for the LAUNCHER WEAPON that has to match, which is a different value.",
    "itmAbility.projectileAnimation":
        "Indexes PROJECTL.IDS (MISSILE.IDS on older engines), but at an offset this project has not " +
        "established: IESDP documents its SPL twin as off-by-one and says nothing here, and a sample of a real " +
        "BG:EE install fits neither reading cleanly. Declaring the table would name every value wrongly, which " +
        "is worse than leaving it a number.",
    "splAbility.projectile":
        "Same table and the same unresolved offset, stated outright by IESDP: 'in BG2, this value is " +
        "off-by-one from projectl.ids value'. Needs a verified key encoding before it can be declared.",
};

const TABLE_MENTION = /\b[A-Za-z][A-Za-z0-9_]{1,11}\.(?:ids|2da)\b/gi;

interface FieldRef {
    readonly kind?: string;
}

/** Every `<spec>.<field>` whose description names at least one IDS/2DA table, with the ref it declares. */
function fieldsNamingATable(): { key: string; tables: string[]; refKind: string | undefined }[] {
    const out: { key: string; tables: string[]; refKind: string | undefined }[] = [];
    for (const [specName, spec] of Object.entries(SPECS)) {
        for (const [fieldName, def] of Object.entries(spec as Record<string, unknown>)) {
            if (typeof def !== "object" || def === null) continue;
            const record = def as { description?: unknown; ref?: FieldRef };
            const description = typeof record.description === "string" ? record.description : "";
            const tables = [...description.matchAll(TABLE_MENTION)].map((m) => m[0].toUpperCase());
            if (tables.length === 0) continue;
            out.push({ key: `${specName}.${fieldName}`, tables: [...new Set(tables)], refKind: record.ref?.kind });
        }
    }
    return out;
}

const NAMED = fieldsNamingATable();

describe("fields whose documentation names an IDS/2DA table", () => {
    // Guards the guard: a description-format change upstream, or a renamed spec export, would empty the sweep
    // and every assertion below would pass over nothing.
    it("finds the documented fields at all", () => {
        expect(NAMED.length).toBeGreaterThanOrEqual(9);
    });

    it("either declares the table or records why it indexes none", () => {
        const undeclared = NAMED.filter((f) => f.refKind !== "ids" && f.refKind !== "2da")
            .filter((f) => NAMES_A_TABLE_BUT_INDEXES_NONE[f.key] === undefined)
            .map((f) => `${f.key} (names ${f.tables.join(", ")})`);

        expect(undeclared).toEqual([]);
    });

    // An exclusion that has since been declared is stale: it would keep a real regression quiet if the
    // declaration were later removed.
    it("carries no exclusion for a field that now declares its table", () => {
        const declaredKeys = new Set(NAMED.filter((f) => f.refKind === "ids" || f.refKind === "2da").map((f) => f.key));
        const stale = Object.keys(NAMES_A_TABLE_BUT_INDEXES_NONE).filter((k) => declaredKeys.has(k));

        expect(stale).toEqual([]);
    });

    // ...and one naming a field that no longer exists, or no longer mentions a table, is equally dead weight.
    it("carries no exclusion for a field the sweep no longer sees", () => {
        const seen = new Set(NAMED.map((f) => f.key));
        const orphaned = Object.keys(NAMES_A_TABLE_BUT_INDEXES_NONE).filter((k) => !seen.has(k));

        expect(orphaned).toEqual([]);
    });
});
