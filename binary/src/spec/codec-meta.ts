import { u8, u16, u32, i8, i16, i32, type ISchema } from "typed-binary";

type NumericTypeName = "uint8" | "uint16" | "uint32" | "int8" | "int16" | "int32";

interface CodecMeta {
    readonly name: NumericTypeName;
    readonly bytes: 1 | 2 | 4;
}

const META = new Map<ISchema<number>, CodecMeta>([
    [u8, { name: "uint8", bytes: 1 }],
    [u16, { name: "uint16", bytes: 2 }],
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

export function codecByteLength(codec: ISchema<number>): 1 | 2 | 4 {
    return meta(codec).bytes;
}
