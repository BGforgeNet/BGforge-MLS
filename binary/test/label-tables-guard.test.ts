/**
 * Guard for the hand-authored enum/flag DISPLAY-LABEL tables (binary/src/<fmt>/types.ts + ie-common).
 *
 * Why this exists: these value->label tables are NOT generated, and the round-trip tests assert BYTES, so a
 * wrong label (mis-shifted bits, wrong enum value) is invisible to the rest of the suite. That gap shipped a
 * garbled SPL exclusion-flags table plus several others (SPL flags/casting, ITM ability flags, PRO action
 * flags). Two layered defenses here:
 *
 *   A. SOURCE REGISTRY (always-on). Every label table must be listed in TABLE_SOURCES with a source citation.
 *      A new, uncited table fails this test until its authoritative source is recorded - closing the "wrote a
 *      table from memory with no cited source" root cause.
 *
 *   B. MACHINE CROSS-CHECK (skip-if-absent). For tables backed by a machine-readable engine source on disk
 *      (sfall Enums.h, a committed-but-fetched third-party header), parse the enum and assert the table's
 *      value-keys are real engine values. This catches a wrong-POSITION value directly (the exclusion/flags
 *      bug class). It compares numeric keys, not labels, so humanized labels ("Big Guns" for STAT_bg) do not
 *      false-positive. external/ is gitignored (fetched), so this skips when the source is absent and runs in
 *      the integration tier / locally. IESDP flag-grid tables are HTML prose and stay citation-only (covered
 *      instead by the per-fixture .pro.json / parser snapshots, which name every set bit of real records).
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import * as itm from "../src/itm/types";
import * as spl from "../src/spl/types";
import * as cre from "../src/cre/types";
import * as pro from "../src/pro/types";
import * as map from "../src/map/types";
import * as ieCommonTypes from "../src/ie-common/types";
import * as ieCommonOpcodes from "../src/ie-common/opcodes";

type LabelTable = Record<number, string>;

const MODULES: Record<string, Record<string, unknown>> = {
    itm,
    spl,
    cre,
    pro,
    map,
    "ie-common": { ...ieCommonTypes, ...ieCommonOpcodes },
};

/** A label table is an object whose keys are all integers and whose values are all strings. */
function isLabelTable(v: unknown): v is LabelTable {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
    const keys = Object.keys(v);
    if (keys.length === 0) return false;
    return keys.every((k) => /^-?\d+$/.test(k)) && Object.values(v).every((x) => typeof x === "string");
}

/** Discover every exported label table as "<module>.<ExportName>" -> table. */
function discoverTables(): Map<string, LabelTable> {
    const out = new Map<string, LabelTable>();
    for (const [mod, ns] of Object.entries(MODULES)) {
        for (const [name, val] of Object.entries(ns)) {
            if (isLabelTable(val)) out.set(`${mod}.${name}`, val);
        }
    }
    return out;
}

// --- A. Source registry --------------------------------------------------------------------------
// One authoritative-source citation per table. IE tables cite the local IESDP docs/IDS/2da; Fallout tables
// cite sfall Enums.h / fallout2-ce headers (or the falloutmods PRO wiki where the engine leaves a bit unnamed).
// Keep in sync with the tables: the completeness test below fails on any table missing here or any stale entry.
const TABLE_SOURCES: Record<string, string> = {
    // ITM (IESDP itm_v1.htm + 2da)
    "itm.ItmFlags": "IESDP itm_v1.htm #Header_Flags",
    "itm.ItmType": "IESDP itemtype.2da (itm_v1)",
    "itm.ItmUsabilityByte1Flags": "IESDP itm_v1.htm #Header_Usability (byte 1)",
    "itm.ItmUsabilityByte2Flags": "IESDP itm_v1.htm #Header_Usability (byte 2)",
    "itm.ItmUsabilityByte3Flags": "IESDP itm_v1.htm #Header_Usability (byte 3)",
    "itm.ItmUsabilityByte4Flags": "IESDP itm_v1.htm #Header_Usability (byte 4)",
    "itm.ItmKitUsabilityByte1Flags": "IESDP itm_v1.htm #Header_Usability (kit byte 1)",
    "itm.ItmKitUsabilityByte2Flags": "IESDP itm_v1.htm #Header_Usability (kit byte 2)",
    "itm.ItmKitUsabilityByte3Flags": "IESDP itm_v1.htm #Header_Usability (kit byte 3)",
    "itm.ItmKitUsabilityByte4Flags": "IESDP itm_v1.htm #Header_Usability (kit byte 4)",
    "itm.ItmWeaponProficiency": "IESDP itm_v1.htm proficiency (stats.ids range)",
    "itm.ItmAbilityAttackType": "IESDP itm_v1 extended_header attack_type",
    "itm.ItmAbilityLocation": "IESDP itm_v1 extended_header location",
    "itm.ItmAbilityProjectileType": "IESDP itm_v1 extended_header projectile_type",
    "itm.ItmAbilityDamageType": "IESDP itm_v1 extended_header damage_type",
    "itm.ItmAbilityDepletion": "IESDP itm_v1 extended_header depletion",
    "itm.ItmAbilityFlags": "IESDP itm_v1.htm #ExtHeader_Flags",

    // SPL (IESDP spl_v1.htm)
    "spl.SplFlags": "IESDP spl_v1.htm #Header_Flags",
    "spl.SplType": "IESDP spl_v1 header type",
    "spl.SplExclusionFlags": "IESDP spl_v1.htm #Exclusion_Flags",
    "spl.SplCastingGraphics": "IESDP spl_v1.htm #Header_Casting_Graphics",
    "spl.SplAbilityForm": "IESDP spl_v1 extended_header form",
    "spl.SplAbilityFriendly": "IESDP spl_v1 extended_header friendly",
    "spl.SplAbilityLocation": "IESDP spl_v1 extended_header location",

    // CRE (IESDP cre_v1.htm + per-game IDS)
    "cre.CreCreatureFlags": "IESDP cre_v1.htm creature flags",
    "cre.CreStatusFlags": "IESDP cre_v1.htm status flags (STATE.IDS)",
    "cre.CreEffStructureVersion": "IESDP cre_v1.htm effect-structure-version byte",
    "cre.CreSex": "IDS gender.htm (bgee)",
    "cre.CreEnemyAlly": "IDS ea.htm (bgee)",
    "cre.CreGeneral": "IDS general.htm (bgee)",
    "cre.CreSpecific": "IDS specific.htm (bgee)",
    "cre.CreRace": "IDS race.htm (bg2)",
    "cre.CreClass": "IDS class.htm (bgee)",
    "cre.CreAlignment": "IDS alignmen.htm (bg2)",
    "cre.CreKit": "IESDP cre_v1.htm KIT.IDS dword values",
    "cre.CreSpellType": "IESDP cre_v1.htm spell type",
    "cre.CreMemorizedSpellFlags": "IESDP cre_v1.htm memorized-spell flags",
    "cre.CreItemFlags": "IESDP cre_v1.htm item flags",
    "cre.CRE_SELECTED_WEAPON_OPTIONS": "IESDP cre_v1.htm selected-weapon slot (slots.ids index - 35)",

    // PRO (sfall Enums.h / fallout2-ce; falloutmods wiki where engine leaves a bit unnamed)
    "pro.ObjectType": "sfall Enums.h ObjType",
    "pro.ItemSubType": "fallout2-ce proto_types.h ITEM_TYPE_*",
    "pro.ScenerySubType": "fallout2-ce proto_types.h SCENERY_TYPE_* (placement naming)",
    "pro.DamageType": "sfall Enums.h DamageType",
    "pro.MaterialType": "sfall Enums.h Material",
    "pro.FRMType": "sfall Enums.h ObjType/ArtType (art directory order)",
    "pro.BodyType": "sfall Enums.h BodyType",
    "pro.KillType": "sfall Enums.h KillType",
    "pro.ElevatorType": "generic indexed labels (no named engine enum; ELEVATOR.INI indices)",
    "pro.WeaponAnimCode": "fallout2-ce art.h WeaponAnimation (FRM suffix letters)",
    "pro.Caliber": "fallout2-ce proto_types.h CALIBER_TYPE_*",
    "pro.AttackSubType": "fallout2-ce item.cc _attack_subtype (sfall EngineUtils weapon_types)",
    "pro.Perk": "sfall Enums.h Perk (fallout2-ce perk_defs.h)",
    "pro.StatType": "sfall Enums.h Stat",
    "pro.HeaderFlags": "sfall Enums.h ObjectFlag (fallout2-ce obj_types.h ObjectFlags)",
    "pro.ItemFlagsExt": "fallout2-ce proto_types.h ItemProtoExtendedFlags (high 3 bytes, >>8)",
    "pro.WallLightFlags": "fallout2-ce PROTO_EXT_FLAG_*_CORNER (>>16) + falloutmods wiki orientation",
    "pro.ActionFlags": "fallout2-ce proto_types.h ItemProtoExtendedFlags (low 16; proto.cc:264)",
    "pro.ContainerFlags": "falloutmods PRO wiki (openFlags bits unnamed in sfall/fallout2-ce)",
    "pro.CritterFlags": "sfall Enums.h CritterFlags (fallout2-ce obj_types.h CritterFlags)",
    "pro.CritterFlagsExt": "fallout2-ce proto_types.h ItemProtoExtendedFlags (LOOK/CAN_TALK_TO)",
    "pro.Gender": "sfall Enums.h Gender",
    "pro.ScriptType": "sfall Enums.h Scripts::ScriptTypes (fallout2-ce scripts.h)",

    // MAP (sfall Enums.h / fallout2-ce)
    "map.MapVersion": "fallout2-ce map.cc map versions 19/20",
    "map.ScriptType": "sfall Enums.h ScriptTypes (fallout2-ce scripts.h)",
    "map.ScriptProc": "fallout2-ce scripts.h SCRIPT_PROC_*",
    "map.Skill": "fallout2-ce skill_defs.h (sfall Enums.h)",
    "map.MapElevation": "fallout2-ce map_defs.h ELEVATION_COUNT",
    "map.Rotation": "Fallout hex direction order NE/E/SE/SW/W/NW",
    "map.MapFlags": "fallout2-ce map.cc map header flags",
    "map.ScriptFlags": "fallout2-ce scripts.h SCRIPT_FLAG_* (anonymous; labels are behavioral readings)",
    "map.ObjectFlags": "fallout2-ce obj_types.h ObjectFlags (sfall ObjectFlag)",
    "map.ObjectDataFlags": "fallout2-ce obj_types.h OBJ_LOCKED/OBJ_JAMMED",
    "map.ItemSubType": "fallout2-ce proto_types.h ITEM_TYPE_*",
    "map.ScenerySubType": "fallout2-ce proto_types.h SCENERY_TYPE_* (direction naming)",

    // ie-common (IESDP)
    "ie-common.Opcodes": "IESDP _opcodes/opNNN.html opname",
    "ie-common.EffectTarget": "IESDP effect target type",
    "ie-common.EffectTiming": "IESDP effect timing mode",
    "ie-common.EffectResistanceFlags": "IESDP effect resistance/dispel flags",
    "ie-common.EffectSaveTypeFlags": "IESDP effect save-type flags",
    "ie-common.EffectParentResourceFlags": "IESDP eff_v2 parent-resource flags",
    "ie-common.EffectParentResourceType": "IESDP eff_v2 parent-resource type",
    "ie-common.Schools": "IESDP mschool.2da (bgee)",
    "ie-common.SecondaryTypes": "IESDP msectype.2da (bgee)",
    "ie-common.AbilityTargetType": "IESDP itm/spl ability target",
    "ie-common.AbilityIdRequiredFlags": "IESDP itm/spl ability id-required flags",
};

// --- B. sfall cross-check ------------------------------------------------------------------------
// Only the SIMPLE, UNSHIFTED Fallout value enums that sfall Enums.h names directly and that the codebase reads
// at full width (so the table keys ARE the engine values). The shifted flag tables (ItemFlagsExt >>8, ActionFlags
// low-16, WallLightFlags >>16) are deliberately excluded - their keys are transformed, so a raw subset check
// would false-positive; they are guarded instead by the corrected per-fixture .pro.json snapshots.
const SFALL_ENUMS_PATH = path.resolve("external/fallout/sfall/sfall/FalloutEngine/Enums.h");

interface SfallCheck {
    key: string; // table key in TABLE_SOURCES / discoverTables
    enumName: string; // sfall Enums.h enum name
}
const SFALL_CHECKS: SfallCheck[] = [
    { key: "pro.ObjectType", enumName: "ObjType" },
    { key: "pro.DamageType", enumName: "DamageType" },
    { key: "pro.MaterialType", enumName: "Material" },
    { key: "pro.BodyType", enumName: "BodyType" },
    { key: "pro.KillType", enumName: "KillType" },
    { key: "pro.Gender", enumName: "Gender" },
    { key: "pro.Perk", enumName: "Perk" },
    { key: "pro.StatType", enumName: "Stat" },
];

/** Parse a C++ `enum Name [: type] { ... }` body into its set of integer values (handles explicit
 *  hex/decimal members and bare auto-incrementing members; expression-defined members are skipped). */
function parseSfallEnum(src: string, enumName: string): Set<number> | undefined {
    // `enum Name`, `enum class Name`, `enum struct Name`, with an optional `: underlying-type`.
    const m = src.match(new RegExp(`enum\\s+(?:class\\s+|struct\\s+)?${enumName}\\b[^{]*\\{([\\s\\S]*?)\\}`));
    if (!m) return undefined;
    const body = (m[1] ?? "").replaceAll(/\/\/[^\n]*/g, "").replaceAll(/\/\*[\s\S]*?\*\//g, "");
    const values = new Set<number>();
    let next = 0;
    for (const raw of body.split(",")) {
        const member = raw.trim();
        if (!member) continue;
        const mm = member.match(/^(\w+)\s*(?:=\s*(.+))?$/s);
        if (!mm) continue;
        if (mm[2] !== undefined) {
            const lit = mm[2].trim();
            let val: number;
            if (/^0x[0-9a-f]+$/i.test(lit)) val = parseInt(lit, 16);
            else if (/^-?\d+$/.test(lit)) val = parseInt(lit, 10);
            else continue; // expression-defined; cannot eval - skip
            values.add(val);
            next = val + 1;
        } else {
            values.add(next);
            next += 1;
        }
    }
    return values;
}

describe("label-table source registry (citation completeness)", () => {
    const tables = discoverTables();

    it("every discovered label table is registered with a source citation", () => {
        const missing = [...tables.keys()].filter((k) => !TABLE_SOURCES[k]);
        expect(missing, `label tables missing a TABLE_SOURCES citation: ${missing.join(", ")}`).toEqual([]);
    });

    it("every TABLE_SOURCES entry maps to a real table (no stale citations)", () => {
        const stale = Object.keys(TABLE_SOURCES).filter((k) => !tables.has(k));
        expect(stale, `stale TABLE_SOURCES entries (no such table): ${stale.join(", ")}`).toEqual([]);
    });

    it("no citation is empty", () => {
        const empty = Object.entries(TABLE_SOURCES)
            .filter(([, v]) => v.trim() === "")
            .map(([k]) => k);
        expect(empty).toEqual([]);
    });
});

describe("label-table values cross-checked against sfall Enums.h", () => {
    const tables = discoverTables();
    const haveSource = fs.existsSync(SFALL_ENUMS_PATH);
    const enumsSrc = haveSource ? fs.readFileSync(SFALL_ENUMS_PATH, "utf-8") : "";

    it.runIf(haveSource).each(SFALL_CHECKS)(
        "$key keys are real $enumName values (no wrong-position bits)",
        ({ key, enumName }) => {
            const table = tables.get(key);
            expect(table, `table ${key} not found`).toBeDefined();
            const sfall = parseSfallEnum(enumsSrc, enumName);
            expect(sfall, `sfall enum ${enumName} not found in Enums.h`).toBeDefined();
            // Drop negative sentinels (-1 None / -2 Random); every remaining key must be a real engine value.
            const tableKeys = Object.keys(table as LabelTable)
                .map(Number)
                .filter((n) => n >= 0);
            const extras = tableKeys.filter((k) => !(sfall as Set<number>).has(k));
            expect(extras, `${key}: keys absent from sfall ${enumName}: ${extras.join(", ")}`).toEqual([]);
        },
    );

    it.skipIf(haveSource)("skipped: sfall Enums.h not present (run after fetching external/)", () => {
        expect(haveSource).toBe(false);
    });
});
