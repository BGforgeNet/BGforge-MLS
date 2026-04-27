/**
 * Variants registry for the MAP objects array. The format's source of truth
 * for "what kinds of object can the user insert into a per-elevation
 * objects[] collection, and what's the default skeleton for each."
 *
 * Skeletons are null-byte-padded across the board: every numeric field
 * starts at zero, which keeps the registry small and the round-trip
 * obvious. Three cases force a non-zero default:
 *
 *   1. The PID upper byte encodes the variant tag. The parser uses
 *      `(pid >>> 24) & 0xff` to decide which sub-records to expect; the
 *      skeleton has to set those bits or the reparse will misclassify the
 *      inserted record.
 *   2. Optional sub-records present on some variants and not others
 *      (`critterData` for critters, `exitGrid` for exit-grid misc objects).
 *      The writer enforces these — `serializeMapObject` throws if a critter
 *      has no `critterData`.
 *   3. Exit-grid PIDs sit in a fixed range (`0x05000010`–`0x05000017`); a
 *      bare `0x05000000` parses as plain misc, not as an exit grid, so the
 *      skeleton picks the lowest valid exit-grid PID.
 *
 * Every other field stays at the canonical-doc zero value. The user is
 * expected to fill in real values via the existing field editors after
 * insertion. The guarantee is: the skeleton serialises, the bytes reparse
 * cleanly, and the resulting object identifies as the requested variant.
 *
 * Once a second variant-shaped array (script slots in v2.6) ships its own
 * registry, the per-format `*-variants.ts` modules promote into a
 * first-class `variantArraySpec(...)` primitive. See `docs/todo.md`.
 */

import type { MapCanonicalDocument } from "../canonical-schemas";
import { PID_TYPE_CRITTER, PID_TYPE_MISC } from "../parse-helpers";

type MapObject = MapCanonicalDocument["objects"]["elevations"][number]["objects"][number];

const PID_TYPE_SHIFT = 24;
const FIRST_EXIT_GRID_PID = 0x0500_0010;

const ZERO_BASE = {
    id: 0,
    tile: 0,
    x: 0,
    y: 0,
    screenX: 0,
    screenY: 0,
    frame: 0,
    rotation: 0,
    fid: 0,
    flags: 0,
    elevation: 0,
    pid: 0,
    cid: 0,
    lightDistance: 0,
    lightIntensity: 0,
    field74: 0,
    sid: 0,
    scriptIndex: 0,
} as const;

const ZERO_INVENTORY_HEADER = { inventoryLength: 0, inventoryCapacity: 0, inventoryPointer: 0 } as const;

const ZERO_CRITTER_DATA = {
    reaction: 0,
    damageLastTurn: 0,
    combatManeuver: 0,
    currentAp: 0,
    combatResults: 0,
    aiPacket: 0,
    team: 0,
    whoHitMeCid: 0,
    currentHp: 0,
    radiation: 0,
    poison: 0,
} as const;

const ZERO_EXIT_GRID = {
    destinationMap: 0,
    destinationTile: 0,
    destinationElevation: 0,
    destinationRotation: 0,
} as const;

function miscSkeleton(): MapObject {
    return {
        kind: "misc",
        base: { ...ZERO_BASE, pid: PID_TYPE_MISC << PID_TYPE_SHIFT },
        inventoryHeader: { ...ZERO_INVENTORY_HEADER },
        objectData: { dataFlags: 0 },
        inventory: [],
    };
}

function critterSkeleton(): MapObject {
    return {
        kind: "critter",
        base: { ...ZERO_BASE, pid: PID_TYPE_CRITTER << PID_TYPE_SHIFT },
        inventoryHeader: { ...ZERO_INVENTORY_HEADER },
        critterData: { ...ZERO_CRITTER_DATA },
        inventory: [],
    };
}

function exitGridSkeleton(): MapObject {
    return {
        kind: "misc",
        base: { ...ZERO_BASE, pid: FIRST_EXIT_GRID_PID },
        inventoryHeader: { ...ZERO_INVENTORY_HEADER },
        objectData: { dataFlags: 0 },
        exitGrid: { ...ZERO_EXIT_GRID },
        inventory: [],
    };
}

export interface MapObjectVariant {
    readonly id: string;
    readonly label: string;
    readonly defaultElement: () => MapObject;
}

export const MAP_OBJECT_VARIANTS: readonly MapObjectVariant[] = [
    { id: "misc", label: "Misc Object", defaultElement: miscSkeleton },
    { id: "critter", label: "Critter", defaultElement: critterSkeleton },
    { id: "exitGrid", label: "Exit Grid", defaultElement: exitGridSkeleton },
];

export function findMapObjectVariant(id: string | undefined): MapObjectVariant | undefined {
    return MAP_OBJECT_VARIANTS.find((variant) => variant.id === id);
}
