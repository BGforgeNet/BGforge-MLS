import type { BinaryFormatAdapter, ProjectedEntry } from "../format-adapter";
import type { ParsedField, ParsedGroup, ParseOptions, ParseResult } from "../types";
import { createCanonicalMapJsonSnapshot, loadCanonicalMapJsonSnapshot } from "./json-snapshot";
import { rebuildMapCanonicalDocument } from "./canonical";
import {
    buildMapAddEntryBytes,
    buildMapInsertEntryBytes,
    buildMapMoveEntryBytes,
    buildMapRemoveEntryBytes,
    isMapAddableArray,
    isMapRemovableEntry,
} from "./entity-ops";
import { slugify } from "../snapshot-common";

function mapSemanticFieldKey(segments: readonly string[]): string | undefined {
    if (segments.length === 0) {
        return undefined;
    }

    const [first, second, third, fourth, fifth] = segments;

    if (first === "Header") {
        return `map.header.${slugify(second ?? "")}`;
    }

    if (first === "Global Variables") {
        return "map.globalVariables[]";
    }

    if (first === "Local Variables") {
        return "map.localVariables[]";
    }

    if (/^Elevation \d+ Tiles$/.test(first ?? "")) {
        const fieldName = second ?? "";
        const tileMatch = /^Tile \d+ (Floor|Floor Flags|Roof|Roof Flags)$/.exec(fieldName);
        if (!tileMatch) {
            return undefined;
        }

        const tileField =
            tileMatch[1] === "Floor"
                ? "floorTileId"
                : tileMatch[1] === "Floor Flags"
                  ? "floorFlags"
                  : tileMatch[1] === "Roof"
                    ? "roofTileId"
                    : "roofFlags";
        return `map.tiles[].${tileField}`;
    }

    if (first?.endsWith("Scripts")) {
        if (second === "Script Count") {
            return "map.scripts[].count";
        }
        if (/^Extent \d+$/.test(second ?? "")) {
            if (third === "Extent Length") {
                return "map.scripts[].extents[].extentLength";
            }
            if (third === "Extent Next") {
                return "map.scripts[].extents[].extentNext";
            }
            if (/^Slot \d+$/.test(third ?? "")) {
                const entryName = (fourth ?? "").replace(/^Entry \d+ /, "");
                return `map.scripts[].extents[].slots[].${slugify(entryName)}`;
            }
        }
        return undefined;
    }

    if (first === "Objects Section") {
        if (second === "Total Objects") {
            return "map.objects.totalObjects";
        }
        if (/^Elevation \d+ Objects$/.test(second ?? "")) {
            if (third === "Object Count") {
                return "map.objects.elevations[].objectCount";
            }
            if (/^Object \d+\.\d+ /.test(third ?? "")) {
                if (!fourth) {
                    return "map.objects.elevations[].objects[]";
                }
                if (fourth === "Inventory Header") {
                    return `map.objects.elevations[].objects[].inventoryHeader.${slugify(fifth ?? "")}`;
                }
                if (fourth === "Object Data") {
                    return `map.objects.elevations[].objects[].objectData.${slugify(fifth ?? "")}`;
                }
                if (fourth === "Exit Grid") {
                    return `map.objects.elevations[].objects[].exitGrid.${slugify(fifth ?? "")}`;
                }
                if (fourth === "Critter Data") {
                    return `map.objects.elevations[].objects[].critterData.${slugify(fifth ?? "")}`;
                }
                if (/^Inventory Entry \d+$/.test(fourth)) {
                    if (fifth === "Quantity") {
                        return "map.objects.elevations[].objects[].inventory[].quantity";
                    }
                    return `map.objects.elevations[].objects[].inventory[].${slugify(fifth ?? "")}`;
                }
                return `map.objects.elevations[].objects[].base.${slugify(fourth)}`;
            }
        }
    }

    return `map.${segments.map((segment) => slugify(segment)).join(".")}`;
}

function isGroup(entry: ParsedField | ParsedGroup): entry is ParsedGroup {
    return "fields" in entry;
}

function shouldHideMapField(entry: ParsedField): boolean {
    return (
        entry.name === "Padding (field_3C)" ||
        entry.name === "Field 74" ||
        /^Entry \d+ (Next Script Link \(legacy\)|Unknown Field 0x48|Legacy Field 0x50)$/.test(entry.name)
    );
}

/** Receives projected children (after field hiding), not the raw parser group. */
function shouldHideMapGroup(entry: ParsedGroup): boolean {
    if (!entry.name.endsWith("Scripts")) {
        return false;
    }
    if (entry.fields.length !== 1) {
        return false;
    }
    const [firstField] = entry.fields;
    return (
        firstField !== undefined && !isGroup(firstField) && firstField.name === "Script Count" && firstField.value === 0
    );
}

export const mapFormatAdapter: BinaryFormatAdapter = {
    formatId: "map",

    createJsonSnapshot(parseResult: ParseResult): string {
        return createCanonicalMapJsonSnapshot(parseResult);
    },

    loadJsonSnapshot(jsonText: string, parseOptions?: ParseOptions) {
        const result = loadCanonicalMapJsonSnapshot(jsonText, parseOptions);
        return { parseResult: result.parseResult, bytes: result.bytes };
    },

    rebuildCanonicalDocument(parseResult: ParseResult) {
        return rebuildMapCanonicalDocument(parseResult);
    },

    toSemanticFieldKey(segments: readonly string[]): string | undefined {
        return mapSemanticFieldKey(segments);
    },

    shouldHideField(entry: ParsedField): boolean {
        return shouldHideMapField(entry);
    },

    shouldHideGroup(entry: ParsedGroup): boolean {
        return shouldHideMapGroup(entry);
    },

    projectDisplayRoot(
        parseResult: ParseResult,
        projectEntry: (
            parseResult: ParseResult,
            entry: ParsedField | ParsedGroup,
            sourceSegments: readonly string[],
        ) => ProjectedEntry | undefined,
    ): ProjectedEntry[] {
        const projectedFields: ProjectedEntry[] = [];
        let insertedTilesGroup = false;

        for (const entry of parseResult.root.fields) {
            if (isGroup(entry) && /^Elevation \d+ Tiles$/.test(entry.name)) {
                if (!insertedTilesGroup) {
                    projectedFields.push({
                        kind: "group",
                        entry: { name: "Tiles", fields: [], expanded: false },
                        sourceSegments: ["Tiles"],
                        children: [],
                    });
                    insertedTilesGroup = true;
                }
                continue;
            }

            const projectedEntry = projectEntry(parseResult, entry, [entry.name]);
            if (projectedEntry) {
                projectedFields.push(projectedEntry);
            }
        }

        return projectedFields;
    },

    buildAddEntryBytes(parseResult: ParseResult, arrayPath: readonly string[]) {
        return buildMapAddEntryBytes(parseResult, arrayPath);
    },

    buildRemoveEntryBytes(parseResult: ParseResult, entryPath: readonly string[]) {
        return buildMapRemoveEntryBytes(parseResult, entryPath);
    },

    buildInsertEntryBytes(parseResult: ParseResult, entryPath: readonly string[], position: "before" | "after") {
        return buildMapInsertEntryBytes(parseResult, entryPath, position);
    },

    buildMoveEntryBytes(parseResult: ParseResult, entryPath: readonly string[], direction: "up" | "down") {
        return buildMapMoveEntryBytes(parseResult, entryPath, direction);
    },

    isAddableArray(arrayPath: readonly string[]): boolean {
        return isMapAddableArray(arrayPath);
    },

    isRemovableEntry(entryPath: readonly string[]): boolean {
        return isMapRemovableEntry(entryPath);
    },
};
