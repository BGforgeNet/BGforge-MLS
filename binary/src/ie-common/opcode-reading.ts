/**
 * Selecting an effect opcode's meaning for a given game.
 *
 * An opcode number has no engine-neutral definition - each engine decides what it means, and they only mostly
 * agree. `OpcodeReadings` therefore holds one entry per reading; this is the single place that turns "which
 * game is open" into "which of those entries applies", so no consumer invents its own fallback.
 */

import type { IeFlavour } from "../archive/game-type";
import { OpcodeReadings, type OpcodeRelationship } from "./opcode-relationships";
import { Opcodes } from "./opcodes";

/**
 * WeiDU's game flavour -> the engine key IESDP documents readings against. The Enhanced Editions share one
 * engine, so every EE flavour but Planescape's maps to `bgee`; IWD:EE included, since its opcode behaviour
 * follows the EE engine rather than the classic Icewind Dale one.
 */
const ENGINE_BY_FLAVOUR: Readonly<Record<IeFlavour, string>> = {
    bg1: "bg1",
    totsc: "bg1",
    bg2: "bg2",
    tob: "bg2",
    bgt: "bg2",
    iwd: "iwd1",
    how: "iwd1",
    totlm: "iwd1",
    iwd2: "iwd2",
    pst: "pst",
    bgee: "bgee",
    sod: "bgee",
    bg2ee: "bgee",
    iwdee: "bgee",
    eet: "bgee",
    pstee: "pstee",
};

/** The engine assumed when no game is open. BG(2)EE, being the edition most installs run. */
export const DEFAULT_ENGINE = "bgee";

/** Maps a detected game flavour to its engine key, or undefined for a flavour with no reading of its own. */
export function engineForFlavour(flavour: string): string | undefined {
    return ENGINE_BY_FLAVOUR[flavour as IeFlavour];
}

/**
 * The reading of `opcode` that `engine` uses, falling back to the preferred one (index 0, BG(2)EE where it
 * exists) when the engine is unknown or has no reading of its own.
 *
 * The fallback is deliberate rather than an empty result: an engine IESDP does not describe separately reads
 * the opcode the same way as the one it shares a lineage with far more often than not, and showing the
 * preferred reading's labels beats showing a bare number.
 */
export function opcodeReading(opcode: number, engine?: string): OpcodeRelationship | undefined {
    const readings = OpcodeReadings[opcode];
    if (readings === undefined || readings.length === 0) return undefined;
    if (engine !== undefined) {
        const match = readings.find((r) => r.engines?.includes(engine));
        if (match !== undefined) return match;
    }
    return readings[0];
}

const namesByEngine = new Map<string, Readonly<Record<number, string>>>();

/**
 * Opcode -> name as `engine` reads it. Built once per engine and shared, since the caller is a per-row display
 * override and rebuilding a 400-entry map for every effect row would be pure waste.
 *
 * `Opcodes` (the flat table the spec uses as its `enum`) is the preferred reading's names, so this differs
 * from it only for the numbers the engine reads differently - which is why callers check before overriding.
 */
export function opcodeNames(engine: string): Readonly<Record<number, string>> {
    const cached = namesByEngine.get(engine);
    if (cached !== undefined) return cached;
    const names: Record<number, string> = {};
    for (const key of Object.keys(OpcodeReadings)) {
        const opcode = Number(key);
        const name = opcodeReading(opcode, engine)?.name;
        if (name !== undefined && name !== "") names[opcode] = name;
    }
    namesByEngine.set(engine, names);
    return names;
}

/** Whether `engine` reads `opcode` by a different name than the flat `Opcodes` table gives it. */
export function opcodeNameDiffers(opcode: number, engine: string): boolean {
    const name = opcodeReading(opcode, engine)?.name;
    return name !== undefined && name !== Opcodes[opcode];
}
