import {
    u8,
    u16,
    u32,
    i8,
    i16,
    i32,
    Schema,
    Measurer,
    MaxValue,
    type ISchema,
    type ISerialInput,
    type ISerialOutput,
    type IMeasurer,
} from "typed-binary";

type NumericTypeName = "uint8" | "uint16" | "uint24" | "uint32" | "int8" | "int16" | "int32";

/**
 * 24-bit big-endian unsigned integer. typed-binary has no native u24, so we
 * supply one for fields like PRO `flagsExt` (3 bytes) that don't byte-align
 * to a standard width.
 */
class Uint24Schema extends Schema<number> {
    readonly maxSize = 3;

    read(input: ISerialInput): number {
        const hi = input.readUint8();
        const mid = input.readUint8();
        const lo = input.readUint8();
        return (hi << 16) | (mid << 8) | lo;
    }

    write(output: ISerialOutput, value: number): void {
        output.writeUint8((value >> 16) & 0xff);
        output.writeUint8((value >> 8) & 0xff);
        output.writeUint8(value & 0xff);
    }

    measure(_: number | typeof MaxValue, measurer?: IMeasurer): IMeasurer {
        return (measurer ?? new Measurer()).add(3);
    }
}

export const u24: ISchema<number> = new Uint24Schema();

interface CodecMeta {
    readonly name: NumericTypeName;
    readonly bytes: 1 | 2 | 3 | 4;
}

const META = new Map<ISchema<number>, CodecMeta>([
    [u8, { name: "uint8", bytes: 1 }],
    [u16, { name: "uint16", bytes: 2 }],
    [u24, { name: "uint24", bytes: 3 }],
    [u32, { name: "uint32", bytes: 4 }],
    [i8, { name: "int8", bytes: 1 }],
    [i16, { name: "int16", bytes: 2 }],
    [i32, { name: "int32", bytes: 4 }],
]);

function meta(codec: ISchema<number>): CodecMeta {
    const m = META.get(codec);
    if (!m) {
        throw new Error("Unknown typed-binary numeric codec; not registered in codec-meta.");
    }
    return m;
}

export function codecNumericTypeName(codec: ISchema<number>): NumericTypeName {
    return meta(codec).name;
}

export function codecByteLength(codec: ISchema<number>): 1 | 2 | 3 | 4 {
    return meta(codec).bytes;
}
