/**
 * typed-binary schemas for EFF v2. Little-endian. The header carries
 * signature + version; the body is the 264-byte effect payload.
 */

import { toTypedBinarySchema } from "../spec/derive-typed-binary";
import { effBodySpecAnnotated } from "./specs/body.overrides";
import { effHeaderSpec } from "./specs/header";
import type { SpecData } from "../spec/types";

export const effHeaderSchema = toTypedBinarySchema(effHeaderSpec);
// Codec is built from the annotated spec so a charsSpec override (e.g.
// variableName) flows into the read/write path. The bare auto-generated
// effBodySpec stays the data source for the annotated spread; both must
// describe the same wire layout.
export const effBodySchema = toTypedBinarySchema(effBodySpecAnnotated);

export type { EffHeaderData } from "./specs/header";
export type EffBodyData = SpecData<typeof effBodySpecAnnotated>;
