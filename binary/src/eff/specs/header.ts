// Auto-generated from IESDP _data/file_formats/eff_v2/header.yml. Do not hand-edit.

import { charsSpec, type FieldSpec, type SpecData } from "../../spec/types";

export const effHeaderSpec = {
    signature: charsSpec(4),
    version: charsSpec(4),
} satisfies Record<string, FieldSpec>;

export type EffHeaderData = SpecData<typeof effHeaderSpec>;
