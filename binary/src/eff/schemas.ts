/**
 * typed-binary schemas for EFF v2. Little-endian. The header carries
 * signature + version; the body is the 264-byte effect payload.
 */

import { toTypedBinarySchema } from "../spec/derive-typed-binary";
import { effBodySpec } from "./specs/body";
import { effHeaderSpec } from "./specs/header";

export const effHeaderSchema = toTypedBinarySchema(effHeaderSpec);
export const effBodySchema = toTypedBinarySchema(effBodySpec);

export type { EffHeaderData } from "./specs/header";
export type { EffBodyData } from "./specs/body";
