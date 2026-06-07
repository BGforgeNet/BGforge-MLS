/**
 * MAP declarative layout. Renders a Fallout map on a single dense page instead of the legacy section tabs:
 * the header fields in a panel (with Map Flags as a flag column), the global/local variable arrays as inline
 * lists, the per-elevation object lists and the four script sections (System / Spatial / Timer / Item) as
 * master-detail list blocks - each delegating to the same windowed getChildren path the legacy tabs used, so
 * the nested object tree and the per-extent script slots render exactly as before. One variant ("map"),
 * stamped by the parser.
 *
 * Section keys are the MAP adapter's DISPLAY-root node names (`projectDisplayRoot`), not the raw parse-tree
 * group names: the objects section is projected so each elevation's object array is lifted to a top-level
 * "Elevation N Objects" section (the addable/modifiable lists), and the raw "Objects Section" / tile groups
 * are renamed/collapsed. A map declares 1-3 elevations, so "Elevation 1/2 Objects" reference sections that
 * may be absent; the same is true of "Local Variables" (omitted when the map has none) and the script
 * sections (Fallout maps rarely populate Spatial Scripts). ListBlock renders nothing for an absent section,
 * so the layout statically lists all of them and only the present ones show.
 *
 * Field refs are the MAP adapter's semantic keys (`map.header.<camelCase>`, verified against the model).
 * Omitted from the layout (round-trip is unaffected - the serializer rebuilds from the canonical document):
 *   - the derived count fields `numGlobalVars` / `numLocalVars` (recomputed from the array lengths on save)
 *     and the read-only "Objects" count summary (Total Objects + per-elevation counts);
 *   - the `paddingField3C` reserved padding;
 *   - the per-elevation tile grids (collapsed to a "Tiles" placeholder, ~40k cells each) - not meaningful as
 *     a form; they are a raw grid that round-trips untouched. A map editor with tile art is the right tool.
 */

import { formatLayoutSchema, type FormatLayout } from "../layout-schema-types";

const k = (key: string): string => `map.header.${key}`;

const listRow = (sectionKey: string, render: "inline" | "master-detail", canAdd = false, canModify = false) => ({
    panels: [{ title: sectionKey, blocks: [{ kind: "list" as const, sectionKey, render, canAdd, canModify }] }],
});

export const mapLayout: FormatLayout = formatLayoutSchema.parse({
    schemaVersion: 1,
    format: "map",
    maxContentWidthPx: 1180,
    variants: {
        map: {
            rows: [
                {
                    panels: [
                        {
                            title: "Header",
                            blocks: [
                                {
                                    kind: "fields",
                                    columns: 2,
                                    fields: [
                                        k("version"),
                                        k("filename"),
                                        k("defaultPosition"),
                                        k("defaultElevation"),
                                        k("defaultOrientation"),
                                        k("scriptId"),
                                        k("darkness"),
                                        k("mapId"),
                                        k("timestamp"),
                                    ],
                                },
                            ],
                        },
                        { title: "Map Flags", blocks: [{ kind: "flags", field: k("mapFlags"), columns: 1 }] },
                    ],
                },
                {
                    panels: [
                        {
                            title: "Global Variables",
                            blocks: [
                                {
                                    kind: "list",
                                    sectionKey: "Global Variables",
                                    render: "inline",
                                    canAdd: true,
                                    canModify: true,
                                },
                            ],
                        },
                        {
                            title: "Local Variables",
                            blocks: [
                                {
                                    kind: "list",
                                    sectionKey: "Local Variables",
                                    render: "inline",
                                    canAdd: true,
                                    canModify: true,
                                },
                            ],
                        },
                    ],
                },
                listRow("Elevation 0 Objects", "master-detail", true, true),
                listRow("Elevation 1 Objects", "master-detail", true, true),
                listRow("Elevation 2 Objects", "master-detail", true, true),
                // Scripts are browse/edit-only (the parser refuses structural add/remove on script extents).
                listRow("System Scripts", "master-detail"),
                listRow("Spatial Scripts", "master-detail"),
                listRow("Timer Scripts", "master-detail"),
                listRow("Item Scripts", "master-detail"),
            ],
        },
    },
});
