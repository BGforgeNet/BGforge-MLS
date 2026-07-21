import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BufferReader, BufferWriter } from "typed-binary";
import { armorSchema } from "../src/pro/schemas";
import { ITEM_SUBTYPE_OFFSET } from "../src/pro/types";
import { armorSpec } from "../src/pro/specs/armor";
import { toTypedBinarySchema } from "../src/spec/derive-typed-binary";
import { REPO_ROOT } from "./repo-root";

const ARMOR_FIXTURE = join(REPO_ROOT, "external/fallout/Fallout2_Restoration_Project/data/proto/items/00000595.pro");
const hasFixture = existsSync(ARMOR_FIXTURE);

describe.skipIf(!hasFixture)("armorSpec equivalence with handwritten armorSchema", () => {
    it("derived schema reads bytes identically to handwritten", () => {
        const bytes = readFileSync(ARMOR_FIXTURE);
        const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

        const r1 = new BufferReader(buf, { endianness: "big", byteOffset: ITEM_SUBTYPE_OFFSET });
        const handwritten = armorSchema.read(r1);

        const r2 = new BufferReader(buf, { endianness: "big", byteOffset: ITEM_SUBTYPE_OFFSET });
        const derived = toTypedBinarySchema(armorSpec).read(r2);

        expect(derived).toEqual(handwritten);
    });

    it("derived schema writes identically to handwritten (round-trip)", () => {
        const bytes = readFileSync(ARMOR_FIXTURE);
        const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

        const r = new BufferReader(buf, { endianness: "big", byteOffset: ITEM_SUBTYPE_OFFSET });
        const data = armorSchema.read(r);

        const out1 = new ArrayBuffer(72);
        const out2 = new ArrayBuffer(72);
        armorSchema.write(new BufferWriter(out1, { endianness: "big" }), data);
        toTypedBinarySchema(armorSpec).write(new BufferWriter(out2, { endianness: "big" }), data);

        expect(new Uint8Array(out2)).toEqual(new Uint8Array(out1));
    });
});
