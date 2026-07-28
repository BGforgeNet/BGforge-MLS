// Hand-written from IESDP cre_v1.htm "CRE V1.0 Items Table". 20 bytes.

import { u16, u32 } from "typed-binary";
import { charsSpec, type FieldSpec, type SpecData } from "../../spec/types";

export const creItemSpec = {
    item: { ...charsSpec(8), ref: { kind: "resource", types: ["ITM"] } },
    expirationTime: { codec: u16 },
    quantity1: { codec: u16 },
    quantity2: { codec: u16 },
    quantity3: { codec: u16 },
    itemFlags: { codec: u32 },
} satisfies Record<string, FieldSpec>;

export type CreItemData = SpecData<typeof creItemSpec>;
