/**
 * Shared Zod schemas used by multiple parser modules.
 */

import { z } from "zod";

// Upper bound for opaque-range offset/size: the largest format that carries opaque ranges, MAP, whose source file
// the CLI caps at 16 MB (MAX_FILE_SIZES in max-file-sizes.ts); a range cannot exceed its containing file. Bounding
// both fields stops a crafted JSON snapshot from driving a multi-GB Uint8Array allocation in a canonical writer
// before any format validation runs - the snapshot load path does not pass through the CLI file-size cap. A
// format with a smaller budget (DLG's text block) checks its own before allocating.
// (The MAP canonical writer's own totalSize also carries the MAX_FILE_SIZES.map budget check - see
// map/canonical-writer.ts - covering the array-length-driven portion of that same allocation.)
const MAX_OPAQUE_RANGE_BYTES = 16 * 1024 * 1024;

export const opaqueRangeSchema = z.strictObject({
    label: z.string().min(1),
    offset: z.number().int().min(0).max(MAX_OPAQUE_RANGE_BYTES),
    size: z.number().int().min(0).max(MAX_OPAQUE_RANGE_BYTES),
    hexChunks: z.array(z.string().regex(/^[0-9a-f]+$/i)),
});
