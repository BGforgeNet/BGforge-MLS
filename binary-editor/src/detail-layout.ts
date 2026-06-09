import type { DetailBlock, DetailRow, FieldRef } from "@bgforge/binary";
import type { Row } from "./types";

/**
 * Helpers for rendering a master-detail list entry through a SHARED layout fragment (a `detailVariant`)
 * rather than a generic auto-form, so the same record looks identical wherever it appears (e.g. an EFF v2
 * effect standalone vs embedded in a CRE). See the binary-editor uniform-shared-layout principle.
 *
 * The catch the global layout `fields` map can't serve: that map is keyed first-write-wins by semantic key,
 * and a list collapses every entry to one key (`cre.effects[].v2.opcode` regardless of index) - so it only
 * ever holds the FIRST entry. The detail pane therefore builds a fresh per-entry map from the SELECTED
 * entry's own child rows. Within one entry semantic keys are unique, so the collision is gone.
 */

/** Collect a selected entry's FULL descendant row set, recursing into nested groups, given an async child
 *  fetcher. A flat one-level fetch misses slot-array leaves nested under a sub-group (e.g. an ITM ability's
 *  `Melee Animation` Overhand/Backhand/Thrust slots), so they would never reach the per-entry field map and
 *  the fragment's group block could not resolve them. Returns rows depth-first in tree order. */
export async function collectEntryRows(rootId: string, fetchChildren: (id: string) => Promise<Row[]>): Promise<Row[]> {
    const walk = async (id: string): Promise<Row[]> => {
        const rows = await fetchChildren(id);
        // Fetch sibling subtrees concurrently (each group's children), then splice each group's descendants in
        // right after the group row to keep a stable depth-first preorder.
        const nested = await Promise.all(
            rows.map((row) =>
                row.kind === "group" && row.hasChildren === true ? walk(row.id) : Promise.resolve<Row[]>([]),
            ),
        );
        return rows.flatMap((row, i) => [row, ...nested[i]!]);
    };
    return walk(rootId);
}

/** Build a `FieldRef -> Row` map for one selected entry from its child rows, keyed by each row's semantic
 *  key. Rows without a semantic key (padding/notes/unkeyed) are skipped; the optional `labels` map overrides
 *  a row's display name without touching its key (the same label layer the global layout applies). */
export function buildDetailFieldMap(rows: Row[], labels?: Record<FieldRef, string>): Record<FieldRef, Row> {
    const map: Record<FieldRef, Row> = {};
    for (const row of rows) {
        const key = row.semanticKey;
        if (key === undefined || key in map) continue;
        const override = labels?.[key];
        map[key] = override === undefined ? row : { ...row, name: override };
    }
    return map;
}

/** Every field ref a detail variant references, across all its block kinds. Used to decide whether the
 *  variant matches the selected entry (all refs present) or the editor should fall back to the auto-form. */
export function detailVariantRefs(rows: DetailRow[]): FieldRef[] {
    const refs: FieldRef[] = [];
    const addBlock = (block: DetailBlock): void => {
        switch (block.kind) {
            case "fields":
            case "group":
                refs.push(...block.fields);
                break;
            case "flags":
                refs.push(block.field);
                break;
            case "grid":
                refs.push(...block.items);
                break;
            case "matrix":
                for (const group of block.groups) for (const r of group.rows) refs.push(...Object.values(r.cells));
                break;
        }
    };
    for (const row of rows) for (const panel of row.panels) for (const block of panel.blocks) addBlock(block);
    return refs;
}

/** True when every field the variant references is present in the per-entry map - i.e. the selected entry is
 *  the record kind the variant was authored for. False (-> auto-form fallback) when any ref is missing. */
export function detailVariantResolves(rows: DetailRow[], map: Record<FieldRef, Row>): boolean {
    return detailVariantRefs(rows).every((ref) => ref in map);
}
