import { i32, u32 } from "typed-binary";
import type { FieldSpec, SpecData } from "../../spec/types";
import type { StructPresentation } from "../../spec/presentation";
import { MapElevation, ObjectDataFlags, ObjectFlags, Rotation } from "../types";

/**
 * Wire specs for the fixed-size byte chunks of one MAP object record.
 *
 * The object record itself is recursively nested - each object carries an
 * inventory of `{quantity, object}` pairs and the inner object is a full
 * record. The recursion lives in the orchestrator (`parseObjectAt` in
 * `parse-objects.ts`), not in the spec layer: a self-referential spec
 * primitive would tangle the SpecData type projection. The specs below
 * describe the flat per-record chunks; the orchestrator stitches them.
 *
 * Per-record chunks:
 *   - `objectBaseSpec`    72 bytes - the always-present preamble.
 *   - `inventoryHeaderSpec` 12 bytes - count/capacity/legacy pointer for the
 *     inventory list that follows the payload.
 *   - `critterDataSpec`   44 bytes - present iff PID type is critter.
 *   - `exitGridSpec`      16 bytes - present iff PID names an exit grid.
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
    // Engine-internal int32 with no authored meaning; hidden from the object detail (round-trips via the doc).
    field74: { codec: i32, role: "reserved" as const, hidden: true },
    // The object's script reference. The engine binds an object to its script
    // by `sid` alone: scriptGetScript() linearly searches the map's script
    // lists for a slot whose `sid` matches (fallout2-ce src/scripts.cc). `sid`
    // is `(scriptType << 24) | id`; -1 means no script.
    //
    // Not a validatable cross-record reference either. A non-(-1) `sid` with no
    // matching script slot is NOT corruption: at map load objectLoadAllInternal
    // does `if (scriptGetScript(sid) == -1) obj->sid = -1;` - it silently drops
    // the unresolved sid, no error (fallout2-ce src/object.cc). Objects also get
    // scripts from their proto via objectSetScriptFromProto at creation,
    // independent of the map's stored script lists, so a scripted object need
    // not have a local script slot at all. Verified against the fixture corpus:
    // unmatched object sids occur only in maps that already fail to fully parse
    // (objects-tail opaque), i.e. parser artifacts, not real dangling refs. So
    // do not build a sid-membership cross-record check; it would flag data the
    // engine treats as routine.
    sid: { codec: i32 },
    // NOT a cross-record reference, despite the name. This is an engine runtime
    // cache, not the link the engine reads - object->script binding is by `sid`
    // (above), and fallout2-ce marks this field `// TODO: remove` on its Object
    // struct (src/obj_types.h). It holds a non-positional engine value (e.g.
    // 511, 750, 1473 in artemple.map, with only a handful of scripts present),
    // so it is neither an index into nor a count of the script table. Tagged
    // `reserved`: round-tripped byte-identically, locked in the editor, never
    // recomputed or validated. Do not build a cross-record check against it.
    scriptIndex: { codec: i32, role: "reserved" as const },
} as const satisfies Record<string, FieldSpec>;

export const inventoryHeaderSpec = {
    // Length of the per-object inventory list. The canonical writer calls
    // enforceDerivedFields with the inventory array as ctx, so a stale
    // inventoryLength in a hand-edited JSON snapshot is silently corrected
    // before serialisation - the writer-side invariant matches the spec
    // role tag.
    inventoryLength: {
        codec: i32,
        role: "derivedCount" as const,
        derivedFrom: { array: "inventory" } as const,
    },
    // Engine-set: max inventory size (capacity) and a runtime pointer the
    // engine populates when loading. Round-trip preserves whatever was on
    // disk; the editor must not let the user touch them.
    inventoryCapacity: { codec: i32, role: "reserved" as const },
    inventoryPointer: { codec: i32, role: "reserved" as const },
} as const satisfies Record<string, FieldSpec>;

// The non-critter object data union begins with `data.flags` (the per-object data flags dword). The item /
// scenery / misc subtype payload that follows is decoded separately (see parse-objects' subtype trailers).
export const objectDataSpec = {
    dataFlags: { codec: u32, flags: ObjectDataFlags },
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
export type ObjectDataData = SpecData<typeof objectDataSpec>;
export type InventoryHeaderData = SpecData<typeof inventoryHeaderSpec>;
export type CritterData = SpecData<typeof critterDataSpec>;
export type ExitGridData = SpecData<typeof exitGridSpec>;

// Acronym fields (id, fid, pid, cid, sid) and the numeric-suffix `field74`
// don't round-trip through `humanize` correctly; override them. Other fields
// derive from `humanize(fieldName)` and don't need an entry.
export const objectBasePresentation: StructPresentation<ObjectBaseData> = {
    id: { label: "ID" },
    // FID, PID and SID are all packed dwords (type<<24 | index); hex makes the type nibble legible and stops the
    // master list from showing indistinguishable big decimals (e.g. 0x0500000C, not 83886092). SID is the
    // script reference - the same packed sid the script carries - so it reads in hex like the script's own SID.
    // CID is a plain signed index (-1 = none), so it stays decimal.
    fid: { label: "FID", format: "hex32" },
    pid: { label: "PID", format: "hex32" },
    cid: { label: "CID" },
    sid: { label: "SID", format: "hex32" },
    field74: { label: "Field 74" },
};

// `dataFlags` humanizes to "Data Flags"; the canonical reader/writer key on that field name.
export const objectDataPresentation: StructPresentation<ObjectDataData> = {
    dataFlags: { label: "Data Flags" },
};

// Inventory header keys all humanize cleanly - empty presentation table.
export const inventoryHeaderPresentation: StructPresentation<InventoryHeaderData> = {};

export const critterPresentation: StructPresentation<CritterData> = {
    aiPacket: { label: "AI Packet" },
    currentAp: { label: "Current AP" },
    whoHitMeCid: { label: "Who Hit Me CID" },
    currentHp: { label: "Current HP" },
};

// Exit grid keys all humanize cleanly - empty presentation table.
export const exitGridPresentation: StructPresentation<ExitGridData> = {};
