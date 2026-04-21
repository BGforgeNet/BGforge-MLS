/**
 * Shared Zod schemas used by multiple parser modules.
 */

import { z } from "zod";

export const opaqueRangeSchema = z.strictObject({
    label: z.string().min(1),
    offset: z.number().int().min(0),
    size: z.number().int().min(0),
    hexChunks: z.array(z.string().regex(/^[0-9a-f]+$/i)),
});
