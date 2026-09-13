/**
 * Reader helpers for rebuilding ProCanonicalSnapshot/ProCanonicalDocument
 * from a parsed display tree (ParseResult).
 */

import { clampNumericValue } from "../binary-format-contract";
import { resolveRawValueFromDisplay } from "../display-lookups";
import { createFieldKey, toSemanticFieldKey } from "../presentation-schema";
import { parseWithSchemaValidation } from "../schema-validation";
import { displayNavigator } from "../spec/navigate-display";
import { structFromDisplay } from "../spec/walk-display";
import { ammoSpec, ammoPresentation } from "./specs/ammo";
import { containerSpec, containerPresentation } from "./specs/container";
import { critterSpec, critterPresentation } from "./specs/critter";
import { doorSpec, doorPresentation } from "./specs/door";
import { elevatorSpec, elevatorPresentation } from "./specs/elevator";
import { genericScenerySpec, genericSceneryPresentation } from "./specs/generic-scenery";
import { headerSpec, headerPresentation } from "./specs/header";
import { itemCommonSpec, itemCommonPresentation } from "./specs/item-common";
import { keySpec, keyPresentation } from "./specs/key";
import { ladderSpec, ladderPresentation } from "./specs/ladder";
import { miscSpec, miscPresentation } from "./specs/misc";
import { miscItemSpec, miscItemPresentation } from "./specs/misc-item";
import { sceneryCommonSpec, sceneryCommonPresentation } from "./specs/scenery-common";
import { stairsSpec, stairsPresentation } from "./specs/stairs";
import { tileSpec, tilePresentation } from "./specs/tile";
import { wallSpec, wallPresentation } from "./specs/wall";
import { weaponSpec, weaponPresentation } from "./specs/weapon";
import type { StructPresentation } from "../spec/presentation";
import type { FieldSpec, SpecData } from "../spec/types";
import type { ParsedGroup, ParseResult } from "../types";
import {
    proCanonicalSnapshotSchemaPermissive,
    proCanonicalDocumentSchemaPermissive,
    type ProCanonicalSnapshot,
    type ProCanonicalDocument,
} from "./canonical-schemas";

const { getGroup, getOptionalGroup, getField } = displayNavigator("PRO");

/**
 * Read one field back by display label, accepting the rendering as well as the number: a tree built by
 * hand or loaded from a display-tree JSON snapshot can carry an enum name, a hex or a percent string with
 * no `rawValue` at all.
 */
function readFieldNumber(group: ParsedGroup, fieldName: string, fieldPath: string): number {
    const field = getField(group, fieldName);
    const fullFieldPath = `${fieldPath}.${fieldName}`;
    const fieldSegments = [...fieldPath.split("."), fieldName];
    const fieldKey = toSemanticFieldKey("pro", fieldSegments) ?? createFieldKey(fieldSegments);
    if (typeof field.rawValue === "number") {
        return field.rawValue;
    }
    if (typeof field.value === "number") {
        return field.value;
    }
    if (typeof field.value === "string") {
        const lookedUp = resolveRawValueFromDisplay("pro", fieldKey, fieldName, field.value);
        if (lookedUp !== undefined) {
            return lookedUp;
        }
        if (/^0x[0-9a-f]+$/i.test(field.value)) {
            return Number.parseInt(field.value, 16);
        }
        if (/^-?\d+%$/.test(field.value)) {
            return Number.parseInt(field.value, 10);
        }
    }
    throw new Error(`Field is not numeric: ${fullFieldPath}`);
}

/**
 * Clamp a field to the domain its spec declares. The display tree can hold an edited out-of-range value
 * and the canonical document feeds the writer directly, so the clamp belongs on the way in.
 */
function clampToDomain(value: number, fieldKey: string): number {
    return clampNumericValue(value, "uint32", { format: "pro", fieldKey });
}

/**
 * Walk one section back to typed data, first giving every string-valued field the numeric `rawValue`
 * `structFromDisplay` requires - resolution `readFieldNumber` owns, since the generic walker has no format
 * to resolve a display string against.
 */
function sectionFromDisplay<S extends Record<string, FieldSpec>>(
    group: ParsedGroup,
    spec: S,
    presentation: StructPresentation<SpecData<S>>,
): SpecData<S> {
    let resolved = false;
    const fields = group.fields.map((entry) => {
        if ("fields" in entry || typeof entry.rawValue === "number" || typeof entry.value !== "string") {
            return entry;
        }
        resolved = true;
        return { ...entry, rawValue: readFieldNumber(group, entry.name, group.name) };
    });
    return structFromDisplay(resolved ? { ...group, fields } : group, spec, presentation);
}

/**
 * Rebuild the typed sections with the inverse of the `walkStruct` call that emitted each display group:
 * the walker reads every spec field back by its display label (presentation label or humanized key) and
 * re-projects enums/flags, byte-identical to what `walkStruct` wrote. Each section's canonical shape is
 * `SpecData<spec>` === `toZodSchema(spec)` (see canonical-schemas), so the shapes match exactly.
 */
function rebuildProCanonicalSnapshot(parseResult: ParseResult): ProCanonicalSnapshot {
    const header = getGroup(parseResult.root, "Header");
    const sections: Record<string, unknown> = {};

    const headerFields = sectionFromDisplay(header, headerSpec, headerPresentation);
    const headerData = {
        ...headerFields,
        lightRadius: clampToDomain(headerFields.lightRadius, "pro.header.lightRadius"),
        lightIntensity: clampToDomain(headerFields.lightIntensity, "pro.header.lightIntensity"),
    };

    const itemProperties = getOptionalGroup(parseResult.root, "Item Properties");
    if (itemProperties) {
        sections.itemProperties = sectionFromDisplay(itemProperties, itemCommonSpec, itemCommonPresentation);
    }

    // Armor stays explicit: its display group nests the resistances and thresholds in two sub-groups that
    // reuse one set of labels ("Normal", "Laser", ...), which the label-keyed walker cannot tell apart.
    const armorStats = getOptionalGroup(parseResult.root, "Armor Stats");
    if (armorStats) {
        const dr = getGroup(armorStats, "Damage Resistance");
        const dt = getGroup(armorStats, "Damage Threshold");
        sections.armorStats = {
            ac: readFieldNumber(armorStats, "AC", "Armor Stats"),
            drNormal: readFieldNumber(dr, "Normal", "Armor Stats.Damage Resistance"),
            drLaser: readFieldNumber(dr, "Laser", "Armor Stats.Damage Resistance"),
            drFire: readFieldNumber(dr, "Fire", "Armor Stats.Damage Resistance"),
            drPlasma: readFieldNumber(dr, "Plasma", "Armor Stats.Damage Resistance"),
            drElectrical: readFieldNumber(dr, "Electrical", "Armor Stats.Damage Resistance"),
            drEmp: readFieldNumber(dr, "EMP", "Armor Stats.Damage Resistance"),
            drExplosion: readFieldNumber(dr, "Explosion", "Armor Stats.Damage Resistance"),
            dtNormal: readFieldNumber(dt, "Normal", "Armor Stats.Damage Threshold"),
            dtLaser: readFieldNumber(dt, "Laser", "Armor Stats.Damage Threshold"),
            dtFire: readFieldNumber(dt, "Fire", "Armor Stats.Damage Threshold"),
            dtPlasma: readFieldNumber(dt, "Plasma", "Armor Stats.Damage Threshold"),
            dtElectrical: readFieldNumber(dt, "Electrical", "Armor Stats.Damage Threshold"),
            dtEmp: readFieldNumber(dt, "EMP", "Armor Stats.Damage Threshold"),
            dtExplosion: readFieldNumber(dt, "Explosion", "Armor Stats.Damage Threshold"),
            perk: readFieldNumber(armorStats, "Perk", "Armor Stats"),
            maleFrmId: readFieldNumber(armorStats, "Male FRM ID", "Armor Stats"),
            femaleFrmId: readFieldNumber(armorStats, "Female FRM ID", "Armor Stats"),
        };
    }

    const weaponStats = getOptionalGroup(parseResult.root, "Weapon Stats");
    if (weaponStats) {
        sections.weaponStats = sectionFromDisplay(weaponStats, weaponSpec, weaponPresentation);
    }

    const ammoStats = getOptionalGroup(parseResult.root, "Ammo Stats");
    if (ammoStats) {
        sections.ammoStats = sectionFromDisplay(ammoStats, ammoSpec, ammoPresentation);
    }

    const containerStats = getOptionalGroup(parseResult.root, "Container Stats");
    if (containerStats) {
        sections.containerStats = sectionFromDisplay(containerStats, containerSpec, containerPresentation);
    }

    // Drug stays explicit for the same reason as armor: the effect sub-groups repeat the labels
    // "Amount 0/1/2" and "Duration", so the label alone does not identify the spec field.
    const drugStats = getOptionalGroup(parseResult.root, "Drug Stats");
    if (drugStats) {
        const affected = getGroup(drugStats, "Affected Stats");
        const instant = getGroup(drugStats, "Instant Effect");
        const delayed1 = getGroup(drugStats, "Delayed Effect 1");
        const delayed2 = getGroup(drugStats, "Delayed Effect 2");
        const addiction = getGroup(drugStats, "Addiction");
        sections.drugStats = {
            stat0: readFieldNumber(affected, "Stat 0", "Drug Stats.Affected Stats"),
            stat1: readFieldNumber(affected, "Stat 1", "Drug Stats.Affected Stats"),
            stat2: readFieldNumber(affected, "Stat 2", "Drug Stats.Affected Stats"),
            amount0Instant: readFieldNumber(instant, "Amount 0", "Drug Stats.Instant Effect"),
            amount1Instant: readFieldNumber(instant, "Amount 1", "Drug Stats.Instant Effect"),
            amount2Instant: readFieldNumber(instant, "Amount 2", "Drug Stats.Instant Effect"),
            duration1: readFieldNumber(delayed1, "Duration", "Drug Stats.Delayed Effect 1"),
            amount0Delayed1: readFieldNumber(delayed1, "Amount 0", "Drug Stats.Delayed Effect 1"),
            amount1Delayed1: readFieldNumber(delayed1, "Amount 1", "Drug Stats.Delayed Effect 1"),
            amount2Delayed1: readFieldNumber(delayed1, "Amount 2", "Drug Stats.Delayed Effect 1"),
            duration2: readFieldNumber(delayed2, "Duration", "Drug Stats.Delayed Effect 2"),
            amount0Delayed2: readFieldNumber(delayed2, "Amount 0", "Drug Stats.Delayed Effect 2"),
            amount1Delayed2: readFieldNumber(delayed2, "Amount 1", "Drug Stats.Delayed Effect 2"),
            amount2Delayed2: readFieldNumber(delayed2, "Amount 2", "Drug Stats.Delayed Effect 2"),
            addictionRate: readFieldNumber(addiction, "Rate", "Drug Stats.Addiction"),
            addictionEffect: readFieldNumber(addiction, "Effect", "Drug Stats.Addiction"),
            addictionOnset: readFieldNumber(addiction, "Onset", "Drug Stats.Addiction"),
        };
    }

    const miscItemStats = getOptionalGroup(parseResult.root, "Misc Item Stats");
    if (miscItemStats) {
        sections.miscItemStats = sectionFromDisplay(miscItemStats, miscItemSpec, miscItemPresentation);
    }

    const keyStats = getOptionalGroup(parseResult.root, "Key Stats");
    if (keyStats) {
        sections.keyStats = sectionFromDisplay(keyStats, keySpec, keyPresentation);
    }

    const critterGroup = getOptionalGroup(parseResult.root, "Critter");
    if (critterGroup) {
        sections.critterStats = sectionFromDisplay(critterGroup, critterSpec, critterPresentation);
    }

    const sceneryProperties = getOptionalGroup(parseResult.root, "Scenery Properties");
    if (sceneryProperties) {
        sections.sceneryProperties = sectionFromDisplay(
            sceneryProperties,
            sceneryCommonSpec,
            sceneryCommonPresentation,
        );
    }

    const doorProperties = getOptionalGroup(parseResult.root, "Door Properties");
    if (doorProperties) {
        const doorFields = sectionFromDisplay(doorProperties, doorSpec, doorPresentation);
        sections.doorProperties = {
            ...doorFields,
            walkThruFlag: clampToDomain(doorFields.walkThruFlag, "pro.doorProperties.walkThruFlag"),
        };
    }

    const stairsProperties = getOptionalGroup(parseResult.root, "Stairs Properties");
    if (stairsProperties) {
        sections.stairsProperties = sectionFromDisplay(stairsProperties, stairsSpec, stairsPresentation);
    }

    const elevatorProperties = getOptionalGroup(parseResult.root, "Elevator Properties");
    if (elevatorProperties) {
        sections.elevatorProperties = sectionFromDisplay(elevatorProperties, elevatorSpec, elevatorPresentation);
    }

    const ladderProperties = getOptionalGroup(parseResult.root, "Ladder Properties");
    if (ladderProperties) {
        sections.ladderProperties = sectionFromDisplay(ladderProperties, ladderSpec, ladderPresentation);
    }

    const genericProperties = getOptionalGroup(parseResult.root, "Generic Properties");
    if (genericProperties) {
        sections.genericProperties = sectionFromDisplay(
            genericProperties,
            genericScenerySpec,
            genericSceneryPresentation,
        );
    }

    const wallProperties = getOptionalGroup(parseResult.root, "Wall Properties");
    if (wallProperties) {
        sections.wallProperties = sectionFromDisplay(wallProperties, wallSpec, wallPresentation);
    }

    const tileProperties = getOptionalGroup(parseResult.root, "Tile Properties");
    if (tileProperties) {
        sections.tileProperties = sectionFromDisplay(tileProperties, tileSpec, tilePresentation);
    }

    const miscProperties = getOptionalGroup(parseResult.root, "Misc Properties");
    if (miscProperties) {
        sections.miscProperties = sectionFromDisplay(miscProperties, miscSpec, miscPresentation);
    }

    return parseWithSchemaValidation(
        proCanonicalSnapshotSchemaPermissive,
        {
            schemaVersion: 1,
            format: "pro",
            formatName: parseResult.formatName,
            document: {
                header: headerData,
                sections,
            },
        },
        "Invalid PRO canonical snapshot",
    );
}

export function createProCanonicalSnapshot(parseResult: ParseResult): ProCanonicalSnapshot {
    const embeddedDocument = getProCanonicalDocument(parseResult);
    if (embeddedDocument) {
        return parseWithSchemaValidation(
            proCanonicalSnapshotSchemaPermissive,
            {
                schemaVersion: 1,
                format: "pro",
                formatName: parseResult.formatName,
                document: embeddedDocument,
            },
            "Invalid PRO canonical document",
        );
    }

    return rebuildProCanonicalSnapshot(parseResult);
}

export function rebuildProCanonicalDocument(parseResult: ParseResult): ProCanonicalDocument {
    return rebuildProCanonicalSnapshot(parseResult).document;
}

export function getProCanonicalDocument(parseResult: ParseResult): ProCanonicalDocument | undefined {
    const parsed = proCanonicalDocumentSchemaPermissive.safeParse(parseResult.document);
    return parsed.success ? parsed.data : undefined;
}
