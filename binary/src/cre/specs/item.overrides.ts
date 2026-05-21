import type { FieldSpec } from "../../spec/types";
import { CreItemFlags } from "../types";
import { creItemSpec } from "./item";

export const creItemSpecAnnotated = {
    ...creItemSpec,
    itemFlags: { ...creItemSpec.itemFlags, flags: CreItemFlags },
} satisfies Record<string, FieldSpec>;
