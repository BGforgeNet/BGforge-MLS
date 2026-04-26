import { i32, u32 } from "typed-binary";
import type { FieldSpec, SpecData } from "../../spec/types";
import { MapElevation, ObjectFlags, Rotation } from "../types";

/**
 * Wire specs for the fixed-size byte chunks of one MAP object record.
 *
 * The object record itself is recursively nested — each object carries an
 * inventory of `{quantity, object}` pairs and the inner object is a full
 * record. The recursion lives in the orchestrator (`parseObjectAt` in
 * `parse-objects.ts`), not in the spec layer: a self-referential spec
 * primitive would tangle the SpecData type projection. The specs below
 * describe the flat per-record chunks; the orchestrator stitches them.
 *
 * Per-record chunks:
 *   - `objectBaseSpec`    72 bytes — the always-present preamble.
 *   - `inventoryHeaderSpec` 12 bytes — count/capacity/legacy pointer for the
 *     inventory list that follows the payload.
 *   - `critterDataSpec`   44 bytes — present iff PID type is critter.
 *   - `exitGridSpec`      16 bytes — present iff PID names an exit grid.
 *
 * Item/scenery payloads are not yet decoded here; they require external
 * PRO-resolved subtype information (see parseObjectAt).
 */

export const objectBaseSpec = {
    id: { codec: i32 },
    tile: { codec: i32 },
    x: { codec: i32 },
    y: { codec: i32 },
    screenX: { codec: i32 },
    screenY: { codec: i32 },
    frame: { codec: i32 },
    rotation: { codec: i32, enum: Rotation },
    fid: { codec: u32 },
    flags: { codec: i32, flags: ObjectFlags },
    elevation: { codec: i32, enum: MapElevation },
    pid: { codec: i32 },
    cid: { codec: i32 },
    lightDistance: { codec: i32 },
    lightIntensity: { codec: i32 },
    field74: { codec: i32 },
    sid: { codec: i32 },
    scriptIndex: { codec: i32 },
} as const satisfies Record<string, FieldSpec>;

export const inventoryHeaderSpec = {
    inventoryLength: { codec: i32 },
    inventoryCapacity: { codec: i32 },
    inventoryPointer: { codec: i32 },
} as const satisfies Record<string, FieldSpec>;

export const critterDataSpec = {
    reaction: { codec: i32 },
    damageLastTurn: { codec: i32 },
    combatManeuver: { codec: i32 },
    currentAp: { codec: i32 },
    combatResults: { codec: i32 },
    aiPacket: { codec: i32 },
    team: { codec: i32 },
    whoHitMeCid: { codec: i32 },
    currentHp: { codec: i32 },
    radiation: { codec: i32 },
    poison: { codec: i32 },
} as const satisfies Record<string, FieldSpec>;

export const exitGridSpec = {
    destinationMap: { codec: i32 },
    destinationTile: { codec: i32 },
    destinationElevation: { codec: i32, enum: MapElevation },
    destinationRotation: { codec: i32, enum: Rotation },
} as const satisfies Record<string, FieldSpec>;

export type ObjectBaseData = SpecData<typeof objectBaseSpec>;
export type InventoryHeaderData = SpecData<typeof inventoryHeaderSpec>;
export type CritterData = SpecData<typeof critterDataSpec>;
export type ExitGridData = SpecData<typeof exitGridSpec>;
