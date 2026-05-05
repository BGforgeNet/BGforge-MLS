/**
 * Strict gate at canonical-doc-to-bytes save.
 *
 * The PRO canonical-doc creation path is permissive (proCanonicalDocumentSchemaPermissive)
 * so that out-of-enum / out-of-domain values produced by graceful parsing flow through to
 * the editor and JSON snapshots. The strict gate fires when the user explicitly serialises
 * a canonical document back to bytes — `serializeProCanonicalDocument` runs the strict
 * `proCanonicalSnapshotSchema` validation as its first step, rejecting committable garbage.
 *
 * `serializeProCanonicalSnapshot` (the inner helper) intentionally does NOT validate; it
 * trusts an already-validated snapshot. The gate lives at the document-validation entry
 * point so that callers who built a snapshot via permissive parsing must explicitly opt
 * into validation by going through the document-shaped API.
 */
import { describe, expect, it } from "vitest";
import {
    proCanonicalSnapshotSchemaPermissive,
    serializeProCanonicalDocument,
    serializeProCanonicalSnapshot,
    type ProCanonicalDocument,
    type ProCanonicalSnapshot,
} from "../src/pro/canonical";

function buildMiscDocument(overrides: Partial<{ lightRadius: number; frmType: number }> = {}): ProCanonicalDocument {
    return {
        header: {
            objectType: 5,
            objectId: 1,
            textId: 100,
            frmType: overrides.frmType ?? 5,
            frmId: 9,
            lightRadius: overrides.lightRadius ?? 0,
            lightIntensity: 0,
            flags: 536_870_912,
        },
        sections: {
            miscProperties: { unknown: 0 },
        },
    };
}

function permissiveSnapshot(document: ProCanonicalDocument): ProCanonicalSnapshot {
    return proCanonicalSnapshotSchemaPermissive.parse({
        schemaVersion: 1,
        format: "pro",
        formatName: "Fallout PRO (Prototype)",
        document,
    });
}

describe("PRO canonical-writer — strict gate on save", () => {
    it("accepts an in-spec document via the document-validating entry point", () => {
        const doc = buildMiscDocument();
        const bytes = serializeProCanonicalDocument(doc);
        expect(bytes).toBeInstanceOf(Uint8Array);
        expect(bytes.length).toBeGreaterThan(0);
    });

    it("rejects an out-of-domain field via serializeProCanonicalDocument", () => {
        // lightRadius domain is [0, 8] per binary-format-contract.ts.
        const doc = buildMiscDocument({ lightRadius: 9 });
        expect(() => serializeProCanonicalDocument(doc)).toThrow(/Invalid PRO canonical document/);
    });

    it("rejects an out-of-enum field via serializeProCanonicalDocument", () => {
        // FRMType is 0..7. 99 is unknown.
        const doc = buildMiscDocument({ frmType: 99 });
        expect(() => serializeProCanonicalDocument(doc)).toThrow(/Invalid PRO canonical document/);
    });

    it("serializeProCanonicalSnapshot trusts a permissive snapshot (no inner validation)", () => {
        // The snapshot-shaped API is the trust-but-don't-validate path. A snapshot built
        // through proCanonicalSnapshotSchemaPermissive carries out-of-domain values; the
        // inner serializer writes them verbatim. Use serializeProCanonicalDocument when
        // strict validation is required.
        const snapshot = permissiveSnapshot(buildMiscDocument({ lightRadius: 9 }));
        const bytes = serializeProCanonicalSnapshot(snapshot);
        expect(bytes).toBeInstanceOf(Uint8Array);
    });
});
