/**
 * Zod schemas and types for the DLG canonical data model.
 *
 * The model mirrors the wire: a header, the state and transition tables, and the three (offset,length)
 * tables. It deliberately does NOT hold the resolved trigger/action strings, because the text block's
 * layout is not derivable from its contents. Measured over 4286 real DLGs: identical strings sit at
 * different offsets 11846 times across 1842 files (no dedup), yet 4170 refs across 547 files DO share an
 * offset - so no deterministic layout rule reproduces both, and a writer that recomputed offsets would
 * change the bytes of every one of those files. `readDlg` resolves the strings for consumers; the
 * canonical document keeps the refs that address them.
 */

import { z } from "zod";
import { toZodSchema } from "../spec/derive-zod";
import { opaqueRangeSchema } from "../shared-schemas";
import { dlgHeaderInterruptSpec, dlgHeaderSpec } from "./specs/header";
import { dlgStateSpec } from "./specs/state";
import { dlgTextRefSpec } from "./specs/text-ref";
import { dlgTransitionSpec } from "./specs/transition";

function documentSchema(mode: "strict" | "permissive") {
    return z.strictObject({
        header: toZodSchema(dlgHeaderSpec, { mode }),
        // Absent in BG1-era files, whose header stops at 48 bytes - see `dlgHeaderInterruptSpec`.
        headerInterrupt: toZodSchema(dlgHeaderInterruptSpec, { mode }).optional(),
        states: z.array(toZodSchema(dlgStateSpec, { mode })),
        transitions: z.array(toZodSchema(dlgTransitionSpec, { mode })),
        stateTriggerRefs: z.array(toZodSchema(dlgTextRefSpec, { mode })),
        transitionTriggerRefs: z.array(toZodSchema(dlgTextRefSpec, { mode })),
        actionRefs: z.array(toZodSchema(dlgTextRefSpec, { mode })),
    });
}

export const dlgCanonicalDocumentSchema = documentSchema("strict");
export const dlgCanonicalDocumentSchemaPermissive = documentSchema("permissive");

export type DlgCanonicalDocument = z.infer<typeof dlgCanonicalDocumentSchema>;

function snapshotSchema(document: z.ZodTypeAny) {
    return z.strictObject({
        schemaVersion: z.literal(1),
        format: z.literal("dlg"),
        formatName: z.string().min(1),
        document,
        opaqueRanges: z.array(opaqueRangeSchema).optional(),
        warnings: z.array(z.string()).optional(),
        errors: z.array(z.string()).optional(),
    });
}

export const dlgCanonicalSnapshotSchema = snapshotSchema(dlgCanonicalDocumentSchema);
export const dlgCanonicalSnapshotSchemaPermissive = snapshotSchema(dlgCanonicalDocumentSchemaPermissive);

export type DlgCanonicalSnapshot = z.infer<typeof dlgCanonicalSnapshotSchema>;
