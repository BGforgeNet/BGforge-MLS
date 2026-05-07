import { describe, it, expect } from "vitest";
import { BufferReader, BufferWriter } from "typed-binary";
import { toTypedBinarySchema } from "../src/spec/derive-typed-binary";
import {
    otherSlotSpec,
    spatialSlotSpec,
    timerSlotSpec,
    OTHER_SLOT_BYTES,
    SPATIAL_SLOT_BYTES,
    TIMER_SLOT_BYTES,
} from "../src/map/specs/script-slot";
import { intToFlagDict } from "../src/spec/coded-projection";
import { ScriptFlags } from "../src/map/types";

const otherCodec = toTypedBinarySchema(otherSlotSpec);
const spatialCodec = toTypedBinarySchema(spatialSlotSpec);
const timerCodec = toTypedBinarySchema(timerSlotSpec);

function buildOtherBytes(): { bytes: ArrayBuffer; expected: Record<string, unknown> } {
    const bytes = new ArrayBuffer(OTHER_SLOT_BYTES);
    const w = new BufferWriter(bytes, { endianness: "big" });
    // Wire shape (raw ints) used only to construct the byte buffer; the
    // `expected` value compared after the read carries `flags` as the named
    // dict the wire codec produces.
    const wireInts: Record<string, number> = {
        sid: 0x0300_0001, // type 3, id 1
        nextScriptLinkLegacy: -1,
        flags: 0,
        index: 1,
        programPointerSlot: 2,
        ownerId: 3,
        localVarsOffset: 4,
        numLocalVars: 5,
        returnValue: 6,
        action: 7,
        fixedParam: 8,
        actionBeingUsed: 9,
        scriptOverrides: 10,
        unknownField0x48: 11,
        checkMarginHowMuch: 12,
        legacyField0x50: 13,
    };
    w.writeUint32(wireInts.sid!);
    w.writeInt32(wireInts.nextScriptLinkLegacy!);
    for (const k of [
        "flags",
        "index",
        "programPointerSlot",
        "ownerId",
        "localVarsOffset",
        "numLocalVars",
        "returnValue",
        "action",
        "fixedParam",
        "actionBeingUsed",
        "scriptOverrides",
        "unknownField0x48",
        "checkMarginHowMuch",
        "legacyField0x50",
    ]) {
        w.writeInt32(wireInts[k]!);
    }
    const expected: Record<string, unknown> = {
        ...wireInts,
        flags: intToFlagDict(ScriptFlags, wireInts.flags!, 32),
    };
    return { bytes, expected };
}

describe("script slot specs", () => {
    it("other-slot spec round-trips a 64-byte slot", () => {
        const { bytes, expected } = buildOtherBytes();
        const r = new BufferReader(bytes, { endianness: "big" });
        expect(otherCodec.read(r)).toEqual(expected);
    });

    it("spatial-slot spec is 72 bytes (8 + 8 spatial + 56 commons)", () => {
        const buf = new ArrayBuffer(SPATIAL_SLOT_BYTES);
        const w = new BufferWriter(buf, { endianness: "big" });
        spatialCodec.write(w, {
            sid: 0x0100_0007,
            nextScriptLinkLegacy: -1,
            builtTile: 100,
            spatialRadius: 5,
            flags: intToFlagDict(ScriptFlags, 0, 32),
            index: 0,
            programPointerSlot: 0,
            ownerId: 0,
            localVarsOffset: 0,
            numLocalVars: 0,
            returnValue: 0,
            action: 0,
            fixedParam: 0,
            actionBeingUsed: 0,
            scriptOverrides: 0,
            unknownField0x48: 0,
            checkMarginHowMuch: 0,
            legacyField0x50: 0,
        });

        const r = new BufferReader(buf, { endianness: "big" });
        const slot = spatialCodec.read(r);
        expect(slot.sid).toBe(0x0100_0007);
        expect(slot.builtTile).toBe(100);
        expect(slot.spatialRadius).toBe(5);
        expect(SPATIAL_SLOT_BYTES).toBe(72);
    });

    it("timer-slot spec is 68 bytes (8 + 4 timer + 56 commons)", () => {
        const buf = new ArrayBuffer(TIMER_SLOT_BYTES);
        const w = new BufferWriter(buf, { endianness: "big" });
        timerCodec.write(w, {
            sid: 0x0200_000a,
            nextScriptLinkLegacy: -1,
            timerTime: 12345,
            flags: intToFlagDict(ScriptFlags, 0, 32),
            index: 0,
            programPointerSlot: 0,
            ownerId: 0,
            localVarsOffset: 0,
            numLocalVars: 0,
            returnValue: 0,
            action: 0,
            fixedParam: 0,
            actionBeingUsed: 0,
            scriptOverrides: 0,
            unknownField0x48: 0,
            checkMarginHowMuch: 0,
            legacyField0x50: 0,
        });

        const r = new BufferReader(buf, { endianness: "big" });
        const slot = timerCodec.read(r);
        expect(slot.sid).toBe(0x0200_000a);
        expect(slot.timerTime).toBe(12345);
        expect(TIMER_SLOT_BYTES).toBe(68);
    });
});
