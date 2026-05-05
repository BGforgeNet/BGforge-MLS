/**
 * Zod schemas and TypeScript types for the PRO canonical data model.
 * Shared by pro-canonical-reader.ts and pro-canonical-writer.ts.
 */

import { z } from "zod";
import { toZodSchema } from "../spec/derive-zod";
import { ammoSpec } from "./specs/ammo";
import { armorSpec } from "./specs/armor";
import { containerSpec } from "./specs/container";
import { critterSpec } from "./specs/critter";
import { drugSpec } from "./specs/drug";
import { elevatorSpec } from "./specs/elevator";
import { genericScenerySpec } from "./specs/generic-scenery";
import { headerSpec } from "./specs/header";
import { itemCommonSpec } from "./specs/item-common";
import { keySpec } from "./specs/key";
import { miscItemSpec } from "./specs/misc-item";
import { miscSpec } from "./specs/misc";
import { doorSpec } from "./specs/door";
import { ladderSpec } from "./specs/ladder";
import { sceneryCommonSpec } from "./specs/scenery-common";
import { stairsSpec } from "./specs/stairs";
import { tileSpec } from "./specs/tile";
import { wallSpec } from "./specs/wall";
import { weaponSpec } from "./specs/weapon";

// The schemas are constructed via a factory so that we can produce two
// strictness modes from one declaration. Strict (the default) gates
// canonical-doc-to-bytes saves; permissive accepts value-level deviations
// (out-of-enum, out-of-domain, linked-count drift) so that canonical-doc
// creation from parsed bytes and snapshot load tolerate files the strict
// save path would reject. Structural refinements (required subdata sections
// per subType) stay in both modes — without them the doc is not walkable.
type Mode = "strict" | "permissive";

function buildSectionsSchema(mode: Mode) {
    const opt = { mode };
    return z.strictObject({
        itemProperties: toZodSchema(itemCommonSpec, opt).optional(),
        armorStats: toZodSchema(armorSpec, opt).optional(),
        weaponStats: toZodSchema(weaponSpec, opt).optional(),
        ammoStats: toZodSchema(ammoSpec, opt).optional(),
        containerStats: toZodSchema(containerSpec, opt).optional(),
        drugStats: toZodSchema(drugSpec, opt).optional(),
        miscItemStats: toZodSchema(miscItemSpec, opt).optional(),
        keyStats: toZodSchema(keySpec, opt).optional(),
        critterStats: toZodSchema(critterSpec, opt).optional(),
        sceneryProperties: toZodSchema(sceneryCommonSpec, opt).optional(),
        doorProperties: toZodSchema(doorSpec, opt).optional(),
        stairsProperties: toZodSchema(stairsSpec, opt).optional(),
        elevatorProperties: toZodSchema(elevatorSpec, opt).optional(),
        ladderProperties: toZodSchema(ladderSpec, opt).optional(),
        genericProperties: toZodSchema(genericScenerySpec, opt).optional(),
        wallProperties: toZodSchema(wallSpec, opt).optional(),
        tileProperties: toZodSchema(tileSpec, opt).optional(),
        miscProperties: toZodSchema(miscSpec, opt).optional(),
    });
}

function buildDocumentSchema(mode: Mode) {
    return z
        .strictObject({
            header: toZodSchema(headerSpec, { mode }),
            sections: buildSectionsSchema(mode),
        })
        .superRefine((document, ctx) => {
            const objectType = document.header.objectType;
            const sections = document.sections;

            switch (objectType) {
                case 0:
                    if (!sections.itemProperties) {
                        ctx.addIssue({
                            code: "custom",
                            path: ["sections", "itemProperties"],
                            message: "itemProperties is required for item PRO snapshots",
                        });
                        break;
                    }
                    switch (sections.itemProperties.subType) {
                        case 0:
                            if (!sections.armorStats)
                                ctx.addIssue({
                                    code: "custom",
                                    path: ["sections", "armorStats"],
                                    message: "armorStats is required for item subtype 0",
                                });
                            break;
                        case 1:
                            if (!sections.containerStats)
                                ctx.addIssue({
                                    code: "custom",
                                    path: ["sections", "containerStats"],
                                    message: "containerStats is required for item subtype 1",
                                });
                            break;
                        case 2:
                            if (!sections.drugStats)
                                ctx.addIssue({
                                    code: "custom",
                                    path: ["sections", "drugStats"],
                                    message: "drugStats is required for item subtype 2",
                                });
                            break;
                        case 3:
                            if (!sections.weaponStats)
                                ctx.addIssue({
                                    code: "custom",
                                    path: ["sections", "weaponStats"],
                                    message: "weaponStats is required for item subtype 3",
                                });
                            break;
                        case 4:
                            if (!sections.ammoStats)
                                ctx.addIssue({
                                    code: "custom",
                                    path: ["sections", "ammoStats"],
                                    message: "ammoStats is required for item subtype 4",
                                });
                            break;
                        case 5:
                            if (!sections.miscItemStats)
                                ctx.addIssue({
                                    code: "custom",
                                    path: ["sections", "miscItemStats"],
                                    message: "miscItemStats is required for item subtype 5",
                                });
                            break;
                        case 6:
                            if (!sections.keyStats)
                                ctx.addIssue({
                                    code: "custom",
                                    path: ["sections", "keyStats"],
                                    message: "keyStats is required for item subtype 6",
                                });
                            break;
                    }
                    break;
                case 1:
                    if (!sections.critterStats) {
                        ctx.addIssue({
                            code: "custom",
                            path: ["sections", "critterStats"],
                            message: "critterStats is required for critter PRO snapshots",
                        });
                    }
                    break;
                case 2:
                    if (!sections.sceneryProperties) {
                        ctx.addIssue({
                            code: "custom",
                            path: ["sections", "sceneryProperties"],
                            message: "sceneryProperties is required for scenery PRO snapshots",
                        });
                        break;
                    }
                    switch (sections.sceneryProperties.subType) {
                        case 0:
                            if (!sections.doorProperties)
                                ctx.addIssue({
                                    code: "custom",
                                    path: ["sections", "doorProperties"],
                                    message: "doorProperties is required for scenery subtype 0",
                                });
                            break;
                        case 1:
                            if (!sections.stairsProperties)
                                ctx.addIssue({
                                    code: "custom",
                                    path: ["sections", "stairsProperties"],
                                    message: "stairsProperties is required for scenery subtype 1",
                                });
                            break;
                        case 2:
                            if (!sections.elevatorProperties)
                                ctx.addIssue({
                                    code: "custom",
                                    path: ["sections", "elevatorProperties"],
                                    message: "elevatorProperties is required for scenery subtype 2",
                                });
                            break;
                        case 3:
                        case 4:
                            if (!sections.ladderProperties)
                                ctx.addIssue({
                                    code: "custom",
                                    path: ["sections", "ladderProperties"],
                                    message: "ladderProperties is required for scenery subtype 3/4",
                                });
                            break;
                        case 5:
                            if (!sections.genericProperties)
                                ctx.addIssue({
                                    code: "custom",
                                    path: ["sections", "genericProperties"],
                                    message: "genericProperties is required for scenery subtype 5",
                                });
                            break;
                    }
                    break;
                case 3:
                    if (!sections.wallProperties)
                        ctx.addIssue({
                            code: "custom",
                            path: ["sections", "wallProperties"],
                            message: "wallProperties is required for wall PRO snapshots",
                        });
                    break;
                case 4:
                    if (!sections.tileProperties)
                        ctx.addIssue({
                            code: "custom",
                            path: ["sections", "tileProperties"],
                            message: "tileProperties is required for tile PRO snapshots",
                        });
                    break;
                case 5:
                    if (!sections.miscProperties)
                        ctx.addIssue({
                            code: "custom",
                            path: ["sections", "miscProperties"],
                            message: "miscProperties is required for misc PRO snapshots",
                        });
                    break;
            }
        });
}

function buildSnapshotSchema(mode: Mode) {
    return z.strictObject({
        schemaVersion: z.literal(1),
        format: z.literal("pro"),
        formatName: z.string().min(1),
        document: buildDocumentSchema(mode),
    });
}

export const proCanonicalDocumentSchema = buildDocumentSchema("strict");
export const proCanonicalDocumentSchemaPermissive = buildDocumentSchema("permissive");
export const proCanonicalSnapshotSchema = buildSnapshotSchema("strict");
export const proCanonicalSnapshotSchemaPermissive = buildSnapshotSchema("permissive");

export type ProCanonicalSnapshot = z.infer<typeof proCanonicalSnapshotSchema>;
export type ProCanonicalDocument = ProCanonicalSnapshot["document"];
