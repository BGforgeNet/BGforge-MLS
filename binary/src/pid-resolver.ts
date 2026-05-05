/**
 * Default `pid → subType` resolver backed by a packaged Fallout 2 lookup table.
 *
 * MAP records of `pidType` ITEM (0) or SCENERY (2) carry a per-subtype trailer
 * whose layout fallout2-ce determines by reading the referenced `.pro` file
 * (see `proto.cc:objectDataRead`). PROs are not packaged alongside MAPs in
 * user mod trees, so `parseObjectAt` cannot resolve the subtype on its own.
 * This module substitutes a precomputed table extracted from vanilla
 * Fallout 2 master.dat protos. Modded pids that are not in the table return
 * `undefined`; callers can supply a richer resolver via `ParseOptions.pidResolver`.
 *
 * Returned subType values match `ItemSubType` / `ScenerySubType` in
 * `pro/types.ts`: items 0–6 (Armor/Container/Drug/Weapon/Ammo/Misc/Key),
 * scenery 0–5 (Door/Stairs/Elevator/LadderUp/LadderDown/Generic).
 */

import data from "../data/fallout2-pidtypes.json" with { type: "json" };

const PID_TYPE_ITEM = 0;
const PID_TYPE_SCENERY = 2;

const items = data.items as Record<string, number>;
const scenery = data.scenery as Record<string, number>;

export function resolvePidSubType(pid: number): number | undefined {
    if (pid < 0) return undefined;
    const pidType = (pid >>> 24) & 0xff;
    const section = pidType === PID_TYPE_ITEM ? items : pidType === PID_TYPE_SCENERY ? scenery : undefined;
    if (section === undefined) return undefined;
    const value = section[String(pid)];
    return typeof value === "number" ? value : undefined;
}

export type PidResolver = (pid: number) => number | undefined;
