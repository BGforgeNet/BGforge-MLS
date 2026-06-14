import type { BinaryFormatAdapter, ProjectedEntry } from "../format-adapter";
import type { ParsedField, ParsedGroup, ParseOptions, ParseResult } from "../types";
import { createCanonicalMapJsonSnapshot, loadCanonicalMapJsonSnapshot } from "./json-snapshot";
import { rebuildMapCanonicalDocument } from "./canonical";
import {
    buildMapAddEntryBytes,
    buildMapDuplicateEntryBytes,
    buildMapInsertEntryBytes,
    buildMapMoveEntryBytes,
    buildMapRemoveEntryBytes,
    isMapRemovableEntry,
} from "./entity-ops";
import {
    buildMapObjectAddEntryBytes,
    buildMapObjectDuplicateEntryBytes,
    buildMapObjectInsertEntryBytes,
    buildMapObjectInventoryAddBytes,
    buildMapObjectInventoryRemoveBytes,
    buildMapObjectMoveEntryBytes,
    buildMapObjectRemoveEntryBytes,
    isMapObjectRemovableEntry,
} from "./object-ops";
import { mapCompiledPatternFields, mapDomainRanges, mapPresentationSchema } from "./presentation-schema";
import { mapLayout } from "./layout-schema";
import { slugify } from "../spec/presentation";

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

/** Synthetic read-only field carrying an existing field's value under a distinct display name. */
function readonlyCountField(name: string, source: ParsedField): ParsedField {
    return { name, value: source.value, type: source.type, offset: source.offset, size: source.size };
}

/**
 * Project the raw "Objects Section" group into a read-only "Objects" counts form
 * plus one top-level list section per elevation (children = object groups, the
 * per-elevation "Object Count" field moved into the counts form). The counts
 * form is editingLocked so its fields render read-only. Counts are derived and
 * recompute on serialize; surfacing them read-only lets the user see totals
 * without editing them.
 */
function projectObjectsSection(
    parseResult: ParseResult,
    section: ParsedGroup,
    projectEntry: (
        pr: ParseResult,
        entry: ParsedField | ParsedGroup,
        sourceSegments: readonly string[],
    ) => ProjectedEntry | undefined,
): ProjectedEntry[] {
    const out: ProjectedEntry[] = [];
    const totalObjects = section.fields.find((f): f is ParsedField => !isGroup(f) && f.name === "Total Objects");
    const elevationGroups = section.fields.filter(
        (f): f is ParsedGroup => isGroup(f) && /^Elevation \d+ Objects$/.test(f.name),
    );

    // sourceSegments stay rooted at the raw "Objects Section" path so a projected
    // node still maps back to its true structural location even though the display
    // lifts it to depth 0.
    const SECTION = section.name;
    const countChildren: ProjectedEntry[] = [];
    if (totalObjects) {
        countChildren.push({
            kind: "field",
            entry: readonlyCountField("Total Objects", totalObjects),
            sourceSegments: [SECTION, "Total Objects"],
        });
    }
    elevationGroups.forEach((g, i) => {
        const c = g.fields.find((f): f is ParsedField => !isGroup(f) && f.name === "Object Count");
        if (c) {
            countChildren.push({
                kind: "field",
                entry: readonlyCountField(`Elevation ${i} Object Count`, c),
                sourceSegments: [SECTION, g.name, "Object Count"],
            });
        }
    });
    const objectsForm: ParsedGroup = {
        name: "Objects",
        // countChildren is built above with only kind:"field" entries, so every entry is a ParsedField.
        fields: countChildren.map((c) => c.entry as ParsedField),
        editingLocked: true,
    };
    out.push({ kind: "group", entry: objectsForm, sourceSegments: [SECTION], children: countChildren });

    for (const g of elevationGroups) {
        const children = g.fields
            .filter((f) => isGroup(f) || f.name !== "Object Count")
            .map((c) => projectEntry(parseResult, c, [SECTION, g.name, c.name]))
            .filter((c): c is ProjectedEntry => c !== undefined);
        out.push({ kind: "group", entry: g, sourceSegments: [SECTION, g.name], children });
    }
    return out;
}

/**
 * Flatten a "<Type> Scripts" section: lift every script slot out of its storage extent into one continuous
 * "Script N" list (N the global index across all extents), dropping the per-extent paging fields (Extent
 * Length / Extent Next) and the redundant Script Count (the tab badge surfaces the total). The extent of 16
 * slots plus its trailing length/next pointers is a file-storage page boundary, not gameplay structure, so it
 * does not belong in the browse - the same reasoning that lifts per-elevation object arrays in
 * `projectObjectsSection`. Each slot keeps its TRUE source path ([Section, "Extent e", "Slot s"]) so its
 * semantic keys (and thus edits + round-trip) are unchanged; only the display label and nesting flatten.
 * Only called for sections that actually have extents; an empty (count 0) section stays on the normal
 * projectEntry path where `shouldHideGroup` hides it.
 */
function projectScriptsSection(
    parseResult: ParseResult,
    section: ParsedGroup,
    projectEntry: (
        pr: ParseResult,
        entry: ParsedField | ParsedGroup,
        sourceSegments: readonly string[],
    ) => ProjectedEntry | undefined,
): ProjectedEntry {
    const SECTION = section.name;
    const slotChildren: ProjectedEntry[] = [];
    let globalIndex = 0;
    for (const extent of section.fields) {
        if (!isGroup(extent) || !/^Extent \d+$/.test(extent.name)) continue;
        // Each extent is padded to 16 physical slots on disk; only the first `Extent Length` are real scripts
        // (the rest are leftover bytes that round-trip via the canonical document but are NOT scripts). Lift
        // only the used slots - otherwise the list and the tab count are inflated by the padding. Clamp
        // defensively (a broken map can store a garbage length).
        const extentLength = extent.fields.find((f): f is ParsedField => !isGroup(f) && f.name === "Extent Length");
        const used = Math.max(0, Math.min(16, typeof extentLength?.value === "number" ? extentLength.value : 16));
        const slots = extent.fields.filter((f): f is ParsedGroup => isGroup(f) && /^Slot \d+$/.test(f.name));
        for (let i = 0; i < Math.min(used, slots.length); i++) {
            const slot = slots[i]!;
            // Relabel to the global index for display, and strip the per-slot "Entry N " prefix from each field
            // label - it was the slot's storage index, now redundant since the entry itself is "Script N". The
            // semantic key is unaffected: toSemanticFieldKey strips the same "Entry N " prefix when slugifying,
            // so a field named "SID" or "Entry 7 SID" both key to ...slots[].sid. Keep the original [Extent e,
            // Slot s] source path so round-trip is unchanged.
            const relabeled: ParsedGroup = {
                ...slot,
                name: `Script ${globalIndex}`,
                fields: slot.fields.map((f) => ({ ...f, name: f.name.replace(/^Entry \d+ /, "") })),
            };
            const projected = projectEntry(parseResult, relabeled, [SECTION, extent.name, slot.name]);
            if (projected) slotChildren.push(projected);
            globalIndex++;
        }
    }
    const flat: ParsedGroup = { name: SECTION, fields: slotChildren.map((c) => c.entry) };
    return { kind: "group", entry: flat, sourceSegments: [SECTION], children: slotChildren };
}

export const mapFormatAdapter: BinaryFormatAdapter = {
    formatId: "map",
    presentationSchema: mapPresentationSchema,
    compiledPatternFields: mapCompiledPatternFields,
    domainRanges: mapDomainRanges,
    // MAP caches its canonical document behind a lazy getter+setter; assigning undefined resets that cache.
    documentCacheStrategy: "clear",
    layout: mapLayout,

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

            if (isGroup(entry) && entry.name === "Objects Section") {
                projectedFields.push(...projectObjectsSection(parseResult, entry, projectEntry));
                continue;
            }

            // Flatten a non-empty script section's extents into one "Script N" list. An empty section (no
            // extents) falls through to projectEntry, where shouldHideGroup hides it.
            if (
                isGroup(entry) &&
                entry.name.endsWith("Scripts") &&
                entry.fields.some((f) => isGroup(f) && /^Extent \d+$/.test(f.name))
            ) {
                projectedFields.push(projectScriptsSection(parseResult, entry, projectEntry));
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
        return buildMapAddEntryBytes(parseResult, arrayPath) ?? buildMapObjectAddEntryBytes(parseResult, arrayPath);
    },

    buildRemoveEntryBytes(parseResult: ParseResult, arrayPath: readonly string[], index: number) {
        return (
            buildMapRemoveEntryBytes(parseResult, arrayPath, index) ??
            buildMapObjectRemoveEntryBytes(parseResult, arrayPath, index)
        );
    },

    buildInsertEntryBytes(
        parseResult: ParseResult,
        arrayPath: readonly string[],
        index: number,
        position: "before" | "after",
    ) {
        return (
            buildMapInsertEntryBytes(parseResult, arrayPath, index, position) ??
            buildMapObjectInsertEntryBytes(parseResult, arrayPath, index, position)
        );
    },

    buildMoveEntryBytes(
        parseResult: ParseResult,
        arrayPath: readonly string[],
        index: number,
        direction: "up" | "down",
    ) {
        return (
            buildMapMoveEntryBytes(parseResult, arrayPath, index, direction) ??
            buildMapObjectMoveEntryBytes(parseResult, arrayPath, index, direction)
        );
    },

    buildDuplicateEntryBytes(parseResult: ParseResult, arrayPath: readonly string[], index: number) {
        return (
            buildMapDuplicateEntryBytes(parseResult, arrayPath, index) ??
            buildMapObjectDuplicateEntryBytes(parseResult, arrayPath, index)
        );
    },

    // An object's nested inventory is an owner-scoped child collection (childSection "Inventory"); add/remove
    // an entry to the object at `index` in the named elevation section.
    buildAddChildEntryBytes(
        parseResult: ParseResult,
        arrayPath: readonly string[],
        index: number,
        childSection: string,
    ): Uint8Array | undefined {
        if (childSection === "Inventory") return buildMapObjectInventoryAddBytes(parseResult, arrayPath, index);
        return undefined;
    },

    buildRemoveChildEntryBytes(
        parseResult: ParseResult,
        arrayPath: readonly string[],
        index: number,
        childSection: string,
        childIndex: number,
    ): Uint8Array | undefined {
        if (childSection === "Inventory") {
            return buildMapObjectInventoryRemoveBytes(parseResult, arrayPath, index, childIndex);
        }
        return undefined;
    },

    isRemovableEntry(entryPath: readonly string[]): boolean {
        return isMapRemovableEntry(entryPath) || isMapObjectRemovableEntry(entryPath);
    },
};
