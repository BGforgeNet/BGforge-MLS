/**
 * A MAP object's "Data Flags" (the per-object `data.flags` dword, distinct from the main object flags bitfield)
 * renders as a real flag field with named bits, not a bare integer. fallout2-ce defines two bits on it:
 * OBJ_LOCKED 0x02000000 and OBJ_JAMMED 0x04000000 (door/container Locked/Jammed) - src/obj_types.h.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mapParser, buildFileDerivedParseOptions } from "@bgforge/binary";
import { buildModel } from "../src/model";
import { projectRow } from "../src/window";

const FIXTURE = path.resolve(__dirname, "../../client/testFixture/maps/denbus1.map");

describe("MAP object Data Flags renders as a flag field", () => {
    it("shows named Locked/Jammed bits, not a plain integer", () => {
        const m = buildModel(
            mapParser.parse(new Uint8Array(fs.readFileSync(FIXTURE)), buildFileDerivedParseOptions(FIXTURE)),
        );
        const dataFlags = m.nodes.filter((n) => n.name === "Data Flags");
        expect(dataFlags.length, "non-critter objects expose a Data Flags field").toBeGreaterThan(0);

        const row = projectRow(m, dataFlags[0]!);
        expect(row.valueType, "Data Flags is a flag field").toBe("flags");
        const names = Object.values(row.flagOptions ?? {});
        expect(names).toContain("Locked");
        expect(names).toContain("Jammed");
    });
});
