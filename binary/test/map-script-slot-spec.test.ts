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

const otherCodec = toTypedBinarySchema(otherSlotSpec);
const spatialCodec = toTypedBinarySchema(spatialSlotSpec);
const timerCodec = toTypedBinarySchema(timerSlotSpec);

function buildOtherBytes(): { bytes: ArrayBuffer; expected: Record<string, number> } {
    const bytes = new ArrayBuffer(OTHER_SLOT_BYTES);
    const w = new BufferWriter(bytes, { endianness: "big" });
    const expected: Record<string, number> = {
        sid: 0x0300_0001, // type 3, id 1
        nextScriptLink: -1,
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
        checkMargin: 12,
        legacyField0x50: 13,
    };
    w.writeUint32(expected.sid!);
    w.writeInt32(expected.nextScriptLink!);
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
        "checkMargin",
        "legacyField0x50",
    ]) {
        w.writeInt32(expected[k]!);
    }
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
            nextScriptLink: -1,
            builtTile: 100,
            spatialRadius: 5,
            flags: 0,
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
            checkMargin: 0,
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
            nextScriptLink: -1,
            timerTime: 12345,
            flags: 0,
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
            checkMargin: 0,
            legacyField0x50: 0,
        });

        const r = new BufferReader(buf, { endianness: "big" });
        const slot = timerCodec.read(r);
        expect(slot.sid).toBe(0x0200_000a);
        expect(slot.timerTime).toBe(12345);
        expect(TIMER_SLOT_BYTES).toBe(68);
    });
});
