// Auto-generated from IESDP _data/file_formats/spl_v1/header.yml. Do not hand-edit.

import { i32, u16, u32, u8 } from "typed-binary";
import { arraySpec, type FieldSpec, type SpecData } from "../../spec/types";

export const splHeaderSpec = {
    signature: arraySpec({ element: { codec: u8 }, count: 4 }),
    version: arraySpec({ element: { codec: u8 }, count: 4 }),
    unidentifiedName: { codec: i32 },
    unused1: { codec: i32 },
    completionSound: arraySpec({ element: { codec: u8 }, count: 8 }),
    flags: { codec: u32 },
    type: { codec: u16 },
    exclusionFlags: { codec: u32 },
    castingGraphics: { codec: u16 },
    unused2: { codec: u8 },
    school: { codec: u8 },
    unused3: { codec: u8 },
    sectype: { codec: u8 },
    unused4: { codec: u8 },
    unused5: { codec: u8 },
    unused6: { codec: u8 },
    unused7: { codec: u8 },
    unused8: { codec: u8 },
    unused9: { codec: u8 },
    unused10: { codec: u8 },
    unused11: { codec: u8 },
    unused12: { codec: u16 },
    unused13: { codec: u16 },
    level: { codec: u32 },
    unused14: { codec: u16 },
    spellbookIcon: arraySpec({ element: { codec: u8 }, count: 8 }),
    unused15: { codec: u16 },
    unused16: arraySpec({ element: { codec: u8 }, count: 8 }),
    unused17: { codec: u32 },
    description: { codec: i32 },
    unused18: { codec: i32 },
    unused19: arraySpec({ element: { codec: u8 }, count: 8 }),
    unused20: { codec: u32 },
    extendedHeadersOffset: { codec: u32 },
    extendedHeadersCount: { codec: u16 },
    featureBlocksOffset: { codec: u32 },
    castingFeatureBlocksIndex: { codec: u16 },
    castingFeatureBlocksCount: { codec: u16 },
} satisfies Record<string, FieldSpec>;

export type SplHeaderData = SpecData<typeof splHeaderSpec>;
