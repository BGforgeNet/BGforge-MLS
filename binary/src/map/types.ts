/**
 * MAP file format type definitions and lookup tables.
 * Fallout 1 uses version 19, Fallout 2 uses version 20.
 */

export const MapVersion: Record<number, string> = {
    19: "Fallout 1",
    20: "Fallout 2",
};

export const ScriptType: Record<number, string> = {
    0: "System",
    1: "Spatial",
    2: "Timer",
    3: "Item",
    4: "Critter",
};

export const ScriptProc: Record<number, string> = {
    0: "no_p_proc",
    1: "start",
    2: "spatial_p_proc",
    3: "description_p_proc",
    4: "pickup_p_proc",
    5: "drop_p_proc",
    6: "use_p_proc",
    7: "use_obj_on_p_proc",
    8: "use_skill_on_p_proc",
    9: "none_x_bad",
    10: "none_x_bad",
    11: "talk_p_proc",
    12: "critter_p_proc",
    13: "combat_p_proc",
    14: "damage_p_proc",
    15: "map_enter_p_proc",
    16: "map_exit_p_proc",
    17: "create_p_proc",
    18: "destroy_p_proc",
    19: "none_x_bad",
    20: "none_x_bad",
    21: "look_at_p_proc",
    22: "timed_event_p_proc",
    23: "map_update_p_proc",
    24: "push_p_proc",
    25: "is_dropping_p_proc",
    26: "combat_is_starting_p_proc",
    27: "combat_is_over_p_proc",
};

export const Skill: Record<number, string> = {
    0: "Small Guns",
    1: "Big Guns",
    2: "Energy Weapons",
    3: "Unarmed",
    4: "Melee Weapons",
    5: "Throwing",
    6: "First Aid",
    7: "Doctor",
    8: "Sneak",
    9: "Lockpick",
    10: "Steal",
    11: "Traps",
    12: "Science",
    13: "Repair",
    14: "Speech",
    15: "Barter",
    16: "Gambling",
    17: "Outdoorsman",
};

export const MapElevation: Record<number, string> = {
    0: "0",
    1: "1",
    2: "2",
};

export const Rotation: Record<number, string> = {
    0: "NE",
    1: "E",
    2: "SE",
    3: "SW",
    4: "W",
    5: "NW",
};

export const MapFlags: Record<number, string> = {
    0x1: "Savegame",
    0x2: "SkipElevation0Tiles",
    0x4: "SkipElevation1Tiles",
    0x8: "SkipElevation2Tiles",
};

export const ScriptFlags: Record<number, string> = {
    0x01: "Loaded",
    0x02: "NoSpatial",
    0x04: "Executed",
    0x08: "NoSave",
    0x10: "NoRemove",
};

export const ObjectFlags: Record<number, string> = {
    0x01: "Hidden",
    0x04: "NoSave",
    0x08: "Flat",
    0x10: "NoBlock",
    0x20: "Lighting",
    0x400: "NoRemove",
    0x800: "Multihex",
    0x1000: "NoHighlight",
    0x2000: "Queued",
    0x4000: "TransRed",
    0x8000: "TransNone",
    0x10000: "TransWall",
    0x20000: "TransGlass",
    0x40000: "TransSteam",
    0x80000: "TransEnergy",
    0x1000000: "InLeftHand",
    0x2000000: "InRightHand",
    0x4000000: "Worn",
    0x10000000: "WallTransEnd",
    0x20000000: "LightThru",
    0x40000000: "Seen",
    0x80000000: "ShootThru",
};

/**
 * Predicate: whether tile bytes for `elevation` (0/1/2) are present in the
 * file. Reads the `MapFlags.SkipElevation0Tiles` / `SkipElevation1Tiles` /
 * `SkipElevation2Tiles` named bits — the named projection makes this an
 * array `.includes` check; the legacy `(flags & (0x2 << elevation)) === 0`
 * bitmask form is preserved as a fallback for callers that still hold a
 * raw int (e.g., low-level parsers).
 */
export function hasElevation(flags: number | { flags: string[]; flagsRaw?: string }, elevation: number): boolean {
    if (typeof flags === "number") {
        return (flags & (0x2 << elevation)) === 0;
    }
    const key =
        elevation === 0 ? "skipElevation0Tiles" : elevation === 1 ? "skipElevation1Tiles" : "skipElevation2Tiles";
    return !flags.flags.includes(key);
}
