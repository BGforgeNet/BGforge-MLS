import { describe, it, expect } from "vitest";
import { parseScripts } from "../src/map/parse-sections";
import { OTHER_SLOT_BYTES } from "../src/map/specs/script-slot";

// A crafted MAP can report any signed int32 script count. A large positive count
// would drive extentCount (= ceil(count / 16)) into the tens of millions before
// the per-slot bounds check fires. parseScripts must clamp the count to what the
// remaining buffer can possibly hold (mirroring clampVarCount / clampObjectCount)
// and treat anything larger as malformed.
describe("parseScripts script-count clamp", () => {
    it("rejects a script count that cannot fit in the remaining buffer", () => {
        // 4-byte count = INT32_MAX, then 96 bytes of slot data (room for at most
        // one OTHER_SLOT_BYTES slot, far fewer than the reported count).
        const data = new Uint8Array(4 + 96);
        const view = new DataView(data.buffer);
        view.setInt32(0, 0x7fffffff, false);

        const errors: string[] = [];
        const result = parseScripts(data, 0, errors, 1);

        // The malformed count is detected up front, not after spinning extents.
        expect(errors.some((e) => e.includes("fit in the remaining buffer"))).toBe(true);
        // The trailer is anchored at the count's own offset so the writer replays
        // the untrusted bytes verbatim (4-byte count was consumed, not pushed).
        expect(result.overflowStart).toBe(0);
        expect(result.scripts).toHaveLength(0);
    });

    it("accepts a script count that fits", () => {
        // count = 0 list: well-formed, no overflow, one empty group emitted.
        const data = new Uint8Array(4);
        const errors: string[] = [];
        const result = parseScripts(data, 0, errors, 1);

        expect(errors).toHaveLength(0);
        expect(result.overflowStart).toBeUndefined();
        expect(result.scripts).toHaveLength(1);
    });

    it("clamps using the smallest slot width as the upper bound", () => {
        // Exactly one OTHER_SLOT_BYTES worth of room after the count, but the count
        // claims two: still malformed (no slot can be only part of a buffer).
        const data = new Uint8Array(4 + OTHER_SLOT_BYTES);
        const view = new DataView(data.buffer);
        view.setInt32(0, 2, false);

        const errors: string[] = [];
        const result = parseScripts(data, 0, errors, 1);

        expect(errors.some((e) => e.includes("fit in the remaining buffer"))).toBe(true);
        expect(result.overflowStart).toBe(0);
    });
});
