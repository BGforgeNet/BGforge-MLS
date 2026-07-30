/**
 * Selecting an effect opcode's meaning for a game.
 *
 * An opcode number has no engine-neutral definition - each engine decides what it means, and they only mostly
 * agree - so `OpcodeReadings` holds one entry per reading and this is the only place that turns "which game"
 * into "which reading". Everything downstream inherits whatever it decides, including the fallback.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_ENGINE, engineForFlavour, opcodeNameDiffers, opcodeNames, opcodeReading } from "../src";
import { OpcodeReadings } from "../src/ie-common/opcode-relationships";
import { Opcodes } from "../src/ie-common/opcodes";

/** No engine at all - the argument a record opened off disk supplies. */
const DEFAULT_ENGINE_ABSENT = undefined;

describe("opcodeReading", () => {
    // Opcode 238 is the standing example of a reused number: two engines, two unrelated effects.
    it("returns the reading the engine uses", () => {
        expect(opcodeReading(238, "bgee")?.name).toBe("Death: Disintegrate");
        expect(opcodeReading(238, "bg2")?.name).toBe("Death: Disintegrate");
        expect(opcodeReading(238, "iwd1")?.name).toBe("Stat: Save vs. all");
        expect(opcodeReading(238, "iwd2")?.name).toBe("Stat: Save vs. all");
    });

    // The readings differ in more than their name - the whole payload follows the engine.
    it("carries that reading's own parameters and refs, not the preferred one's", () => {
        expect(opcodeReading(238, "bgee")?.idsFileByParam2?.[4]).toEqual(["RACE"]);
        expect(opcodeReading(238, "iwd2")?.idsFileByParam2).toBeUndefined();
        expect(opcodeReading(238, "iwd2")?.param1?.label).toBe("Statistic Modifier");
    });

    it("falls back to the preferred reading with no engine, or one that has none of its own", () => {
        expect(opcodeReading(238)?.name).toBe("Death: Disintegrate");
        // No engine key of IESDP's is spelled this way, so there is nothing to match.
        expect(opcodeReading(238, "not-an-engine")?.name).toBe("Death: Disintegrate");
    });

    it("returns nothing for an opcode IESDP does not document", () => {
        expect(opcodeReading(65000, "bgee")).toBeUndefined();
    });

    // The flat `Opcodes` table is what a record parsed with no game shows, so the two must not disagree about
    // which reading is preferred - otherwise the name changes the moment an unrelated field re-projects.
    it("agrees with the flat Opcodes table for every opcode", () => {
        const mismatched = Object.keys(OpcodeReadings)
            .map(Number)
            .filter((n) => opcodeReading(n, DEFAULT_ENGINE_ABSENT)?.name !== Opcodes[n]);

        expect(mismatched).toEqual([]);
    });
});

describe("engineForFlavour", () => {
    // The Baldur's Gate EEs share one engine and one set of readings. IWD:EE rides along because IESDP has no
    // column for it, not because that equivalence was established - see the note on ENGINE_BY_FLAVOUR.
    it.each(["bgee", "sod", "bg2ee", "iwdee", "eet"])("maps the EE flavour %s to the EE engine", (flavour) => {
        expect(engineForFlavour(flavour)).toBe("bgee");
    });

    // PSTEE runs the same engine as the other EEs and reads all but a handful of opcodes identically. It keeps
    // its own key for the numbers Planescape adds, which BG:EE marks Unused.
    it("keeps PSTEE on its own readings, which differ only where Planescape adds opcodes", () => {
        expect(engineForFlavour("pstee")).toBe("pstee");
        expect(opcodeReading(352, "pstee")?.name).toBe("Change Background");
        expect(opcodeReading(352, "bgee")?.name).toBe("Unused");
        // ...and agrees with the other EEs everywhere else.
        expect(opcodeReading(238, "pstee")?.name).toBe(opcodeReading(238, "bgee")?.name);
    });

    it.each([
        ["tob", "bg2"],
        ["bgt", "bg2"],
        ["totsc", "bg1"],
        ["how", "iwd1"],
        ["iwd2", "iwd2"],
        ["pstee", "pstee"],
    ])("maps %s to %s", (flavour, engine) => {
        expect(engineForFlavour(flavour)).toBe(engine);
    });

    it("returns nothing for a value that is not a flavour", () => {
        expect(engineForFlavour("not-a-game")).toBeUndefined();
    });

    it("names an engine the readings actually use", () => {
        expect(opcodeReading(238, DEFAULT_ENGINE)?.name).toBe("Death: Disintegrate");
    });
});

describe("opcodeNames", () => {
    it("names every opcode as the engine reads it", () => {
        const iwd = opcodeNames("iwd2");
        expect(iwd[238]).toBe("Stat: Save vs. all");
        // A number that engine reads the same way is still present, since the dropdown lists them all.
        expect(iwd[177]).toBe("Use EFF File");
    });

    it("is the same object across calls, so a per-row consumer does not rebuild it", () => {
        expect(opcodeNames("bg1")).toBe(opcodeNames("bg1"));
    });

    // What lets a caller skip the swap entirely for the engines that agree - most of them, most of the time.
    it("reports whether the engine's name differs from the flat table", () => {
        expect(opcodeNameDiffers(238, "iwd2")).toBe(true);
        expect(opcodeNameDiffers(238, "bgee")).toBe(false);
        expect(opcodeNameDiffers(177, "iwd2")).toBe(false);
    });
});
