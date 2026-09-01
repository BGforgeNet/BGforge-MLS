/**
 * A MAP item/scenery object's "Sub Type" is shown as a named label (Weapon / Drug / Door / Elevator ...), not
 * the raw engine code, and stays read-only. The field is a synthetic 0-byte `note` carrying the resolved
 * subtype so a snapshot reparse can rebuild the pid->subType resolver (canonical-reader reads its `rawValue`);
 * the code keeps round-tripping while the display reads as a name. Editing it makes no sense - the trailer was
 * already decoded from this code - so it is never editable.
 *
 * Subtype codes per fallout2-ce src/proto_types.h (ITEM_TYPE_* / SCENERY_TYPE_*). Verified against denbus1,
 * which decodes its item objects with the file-derived PRO resolver.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mapParser, buildFileDerivedParseOptions } from "@bgforge/binary";
import { buildModel } from "../src/model";
import { projectRow } from "../src/window";

const FIXTURE = path.resolve(__dirname, "../../client/testFixture/maps/denbus1.map");

const ITEM_SUBTYPES: Record<number, string> = {
    0: "Armor",
    1: "Container",
    2: "Drug",
    3: "Weapon",
    4: "Ammo",
    5: "Misc",
    6: "Key",
};
const SCENERY_SUBTYPES: Record<number, string> = {
    0: "Door",
    1: "Stairs",
    2: "Elevator",
    3: "Ladder Up",
    4: "Ladder Down",
    5: "Generic",
};

function mapModel() {
    return buildModel(mapParser.parse(new Uint8Array(fs.readFileSync(FIXTURE)), buildFileDerivedParseOptions(FIXTURE)));
}

// A "Sub Type" field's grandparent is the "Object N (Type)" group; pull the bracketed type so we know which
// subtype table applies (item codes and scenery codes overlap, e.g. 0 = Armor vs Door).
// Resolves through the model's own `byId` index, as the editor does: denbus1 flattens to ~135k nodes and
// this runs per "Sub Type" field, so a linear scan here is two full walks of the model per object.
function parentOf(
    m: ReturnType<typeof mapModel>,
    node: (typeof m.nodes)[number] | undefined,
): (typeof m.nodes)[number] | undefined {
    if (node?.parentId === undefined) return undefined;
    const idx = m.byId.get(node.parentId);
    return idx === undefined ? undefined : m.nodes[idx];
}

function ancestorObjectType(m: ReturnType<typeof mapModel>, node: (typeof m.nodes)[number]): string | undefined {
    return parentOf(m, parentOf(m, node))?.name?.match(/\(([^)]+)\)$/)?.[1];
}

describe("MAP object Sub Type renders as a named, read-only enum", () => {
    it("shows the item/scenery subtype name and never lets it be edited", () => {
        const m = mapModel();
        const subs = m.nodes.filter((n) => n.name === "Sub Type");
        expect(subs.length, "denbus1 decodes item/scenery objects with subtype trailers").toBeGreaterThan(0);

        let sawNamed = false;
        for (const node of subs) {
            const row = projectRow(m, node);
            expect(row.editable, "Sub Type is read-only (the decoded code must not change)").toBe(false);
            expect(typeof row.rawValue, "rawValue keeps the numeric code for reparse").toBe("number");

            const type = ancestorObjectType(m, node);
            const table = type === "Item" ? ITEM_SUBTYPES : type === "Scenery" ? SCENERY_SUBTYPES : undefined;
            expect(table, `Sub Type under unexpected object type "${type}"`).toBeDefined();
            expect(row.displayValue, `subtype ${row.rawValue} (${type})`).toBe(table![row.rawValue as number]);
            sawNamed = true;
        }
        expect(sawNamed, "exercised at least one named subtype").toBe(true);
    });
});
