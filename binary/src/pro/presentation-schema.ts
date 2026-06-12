/**
 * PRO presentation schema, derived from the same specs + presentations the parser walks (so a new `enum:` /
 * `flags:` on a spec flows through automatically, exactly like the IE formats). Owned by the format adapter
 * (exposed via `BinaryFormatAdapter.presentationSchema` so the top-level `presentation-schema.ts` does not need
 * a parallel registry). The prefixes are `pro.` + the slugified walkStruct group label (see `pro/index.ts`).
 */

import {
    type CompiledPatternFieldPresentation,
    type FormatPresentationSchema,
    compilePatternFields,
    formatPresentationSchema,
} from "../presentation-schema-types";
import type { NumericRange } from "../binary-format-contract";
import { toDomainRanges } from "../spec/derive-domain-ranges";
import { toPresentationEntries } from "../spec/derive-presentation";
import { headerPresentation, headerSpec } from "./specs/header";
import { itemCommonPresentation, itemCommonSpec } from "./specs/item-common";
import { weaponPresentation, weaponSpec } from "./specs/weapon";
import { armorPresentation, armorSpec } from "./specs/armor";
import { ammoPresentation, ammoSpec } from "./specs/ammo";
import { containerPresentation, containerSpec } from "./specs/container";
import { drugPresentation, drugSpec } from "./specs/drug";
import { critterPresentation, critterSpec } from "./specs/critter";
import { sceneryCommonPresentation, sceneryCommonSpec } from "./specs/scenery-common";
import { doorPresentation, doorSpec } from "./specs/door";
import { elevatorPresentation, elevatorSpec } from "./specs/elevator";
import { wallPresentation, wallSpec } from "./specs/wall";
import { tilePresentation, tileSpec } from "./specs/tile";
import { stairsSpec } from "./specs/stairs";
import { ladderSpec } from "./specs/ladder";

// Drug stat dropdowns render inside the "Affected Stats" subgroup (see `parseDrug` in `pro/index.ts`), so their
// semantic key carries that segment. Mirror that one subgroup here; the other drug subgroups hold no enum/flags.
const DRUG_SUBGROUPS = [{ name: "Affected Stats", fields: ["stat0", "stat1", "stat2"] }] as const;

export const proPresentationSchema: FormatPresentationSchema = formatPresentationSchema.parse({
    schemaVersion: 1,
    format: "pro",
    exactFields: {
        ...toPresentationEntries(headerSpec, headerPresentation, "pro.header"),
        ...toPresentationEntries(itemCommonSpec, itemCommonPresentation, "pro.itemProperties"),
        ...toPresentationEntries(weaponSpec, weaponPresentation, "pro.weaponStats"),
        ...toPresentationEntries(armorSpec, armorPresentation, "pro.armorStats"),
        ...toPresentationEntries(ammoSpec, ammoPresentation, "pro.ammoStats"),
        ...toPresentationEntries(containerSpec, containerPresentation, "pro.containerStats"),
        ...toPresentationEntries(drugSpec, drugPresentation, "pro.drugStats", DRUG_SUBGROUPS),
        ...toPresentationEntries(critterSpec, critterPresentation, "pro.critter"),
        ...toPresentationEntries(sceneryCommonSpec, sceneryCommonPresentation, "pro.sceneryProperties"),
        ...toPresentationEntries(doorSpec, doorPresentation, "pro.doorProperties"),
        ...toPresentationEntries(elevatorSpec, elevatorPresentation, "pro.elevatorProperties"),
        ...toPresentationEntries(wallSpec, wallPresentation, "pro.wallProperties"),
        ...toPresentationEntries(tileSpec, tilePresentation, "pro.tileProperties"),
    },
    patternFields: [],
});

export const proCompiledPatternFields: readonly CompiledPatternFieldPresentation[] = compilePatternFields(
    proPresentationSchema.patternFields,
);

// Derived from each spec's `domain:` declarations. Single source of truth:
// the spec's `domain:` field gates the canonical-doc save-time refinement
// (`fieldSpecToZod`); deriving the path-keyed lookup here ensures the
// editor's input bounds (consumed by `validateNumericValue`) cannot drift
// from the save-time bounds.
export const proDomainRanges: Readonly<Record<string, NumericRange>> = {
    ...toDomainRanges(headerSpec, "pro.header"),
    ...toDomainRanges(doorSpec, "pro.doorProperties"),
    ...toDomainRanges(stairsSpec, "pro.stairsProperties"),
    ...toDomainRanges(ladderSpec, "pro.ladderProperties"),
};
