/**
 * MAP presentation schema: per-field labels, enum / flag dropdowns, pattern
 * overrides for the binary editor. Owned by the format adapter.
 */

import { MapElevation, MapFlags, ObjectFlags, Rotation, ScriptProc, ScriptFlags, Skill } from "./types";
import {
    type CompiledPatternFieldPresentation,
    type FormatPresentationSchema,
    compilePatternFields,
    formatPresentationSchema,
    stringifyKeys,
} from "../presentation-schema-types";
import type { NumericRange } from "../binary-format-contract";
import { toPresentationPatterns } from "../spec/derive-presentation";
import { otherSlotSpec } from "./specs/script-slot";
import { inventoryHeaderSpec, objectBaseSpec } from "./specs/object";

/**
 * Drop the legacy `none_x_bad` sentinel from the script-proc dropdown so the
 * editor doesn't expose it as a selectable value.
 */
const scriptProcDropdown = Object.fromEntries(
    Object.entries(ScriptProc)
        .filter(([, value]) => value !== "none_x_bad")
        .map(([key, value]) => [String(key), value]),
) as Record<string, string>;

export const mapPresentationSchema: FormatPresentationSchema = formatPresentationSchema.parse({
    schemaVersion: 1,
    format: "map",
    exactFields: {
        "map.header.version": { label: "Version", editable: false },
        "map.header.defaultElevation": {
            label: "Default Elevation",
            presentationType: "enum",
            enumOptions: stringifyKeys(MapElevation),
        },
        "map.header.defaultOrientation": {
            label: "Default Orientation",
            presentationType: "enum",
            enumOptions: stringifyKeys(Rotation),
        },
        "map.header.numLocalVars": { label: "Num Local Vars", editable: false },
        "map.header.numGlobalVars": { label: "Num Global Vars", editable: false },
        "map.objects.totalObjects": { label: "Total Objects", editable: false },
        "map.header.mapFlags": {
            label: "Map Flags",
            presentationType: "flags",
            flagOptions: {
                "1": MapFlags[0x1]!,
                "2": "Has Elevation 0",
                "4": "Has Elevation 1",
                "8": "Has Elevation 2",
            },
            flagActivation: { "1": "set", "2": "clear", "4": "clear", "8": "clear" },
            editable: false,
        },
        "map.header.filename": { label: "Filename", stringCharset: "ascii-printable" },
    },
    patternFields: [
        {
            pathPattern: "^map\\.objects\\.elevations\\[\\]\\.objects\\[\\]\\.base\\.(pid|fid|cid|sid)$",
            numericFormat: "hex32",
        },
        { pathPattern: "^map\\.scripts\\[\\]\\.extents\\[\\]\\.slots\\[\\]\\.sid$", numericFormat: "hex32" },
        {
            pathPattern: "^map\\.objects\\.elevations\\[\\]\\.objects\\[\\]\\.base\\.rotation$",
            presentationType: "enum",
            enumOptions: stringifyKeys(Rotation),
        },
        {
            pathPattern: "^map\\.objects\\.elevations\\[\\]\\.objects\\[\\]\\.base\\.elevation$",
            presentationType: "enum",
            enumOptions: stringifyKeys(MapElevation),
        },
        {
            pathPattern: "^map\\.objects\\.elevations\\[\\]\\.objects\\[\\]\\.exitGrid\\.destinationElevation$",
            presentationType: "enum",
            enumOptions: stringifyKeys(MapElevation),
        },
        {
            pathPattern: "^map\\.objects\\.elevations\\[\\]\\.objects\\[\\]\\.exitGrid\\.destinationRotation$",
            presentationType: "enum",
            enumOptions: stringifyKeys(Rotation),
        },
        {
            pathPattern: "^map\\.scripts\\[\\]\\.extents\\[\\]\\.slots\\[\\]\\.action$",
            presentationType: "enum",
            enumOptions: scriptProcDropdown,
        },
        {
            pathPattern: "^map\\.scripts\\[\\]\\.extents\\[\\]\\.slots\\[\\]\\.actionBeingUsed$",
            presentationType: "enum",
            enumOptions: stringifyKeys(Skill),
        },
        {
            pathPattern: "^map\\.scripts\\[\\]\\.extents\\[\\]\\.slots\\[\\]\\.flags$",
            presentationType: "flags",
            flagOptions: stringifyKeys(ScriptFlags),
        },
        {
            pathPattern: "^map\\.objects\\.elevations\\[\\]\\.objects\\[\\]\\.base\\.flags$",
            presentationType: "flags",
            flagOptions: stringifyKeys(ObjectFlags),
        },
        // Header / extent / objects-section locks. version + mapFlags are
        // identity bits with no spec role tag; extentLength + extentNext are
        // not in any spec (manual structure in the writer); totalObjects /
        // objectCount are synthetic canonical-doc fields. Kept hand-written.
        { pathPattern: "^map\\.header\\.(version|numLocalVars|numGlobalVars|mapFlags)$", editable: false },
        { pathPattern: "^map\\.scripts\\[\\]\\.extents\\[\\]\\.(extentLength|extentNext)$", editable: false },
        { pathPattern: "^map\\.objects\\.(totalObjects|elevations\\[\\]\\.objectCount)$", editable: false },
        // Per-spec structural / engine-set locks derived from the role
        // annotation on each scalar field. Filter to editable: false so the
        // enum / flags emissions (already covered by the hand-written
        // patterns above) don't duplicate.
        ...toPresentationPatterns(otherSlotSpec, {}, "map.scripts[].extents[].slots[]").filter(
            (p) => p.editable === false,
        ),
        ...toPresentationPatterns(objectBaseSpec, {}, "map.objects.elevations[].objects[].base").filter(
            (p) => p.editable === false,
        ),
        ...toPresentationPatterns(inventoryHeaderSpec, {}, "map.objects.elevations[].objects[].inventoryHeader").filter(
            (p) => p.editable === false,
        ),
    ],
});

export const mapCompiledPatternFields: readonly CompiledPatternFieldPresentation[] = compilePatternFields(
    mapPresentationSchema.patternFields,
);

export const mapDomainRanges: Readonly<Record<string, NumericRange>> = {
    "map.header.defaultElevation": { min: 0, max: 2 },
    "map.header.defaultOrientation": { min: 0, max: 5 },
    "map.objects.elevations[].objects[].exitGrid.destinationElevation": { min: 0, max: 2 },
    "map.objects.elevations[].objects[].exitGrid.destinationRotation": { min: 0, max: 5 },
};
