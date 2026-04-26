import { describe, it, expect } from "vitest";
import { proCanonicalDocumentSchema } from "../src/pro/canonical-schemas";

describe("proCanonicalDocumentSchema header", () => {
    const validBase = {
        header: {
            objectType: 5, // Misc
            objectId: 0,
            textId: 0,
            frmType: 5, // matches Misc objectType
            frmId: 0,
            lightRadius: 0,
            lightIntensity: 0,
            flags: 0,
        },
        sections: { miscProperties: { unknown: 0 } },
    };

    it("accepts a valid header with known objectType / frmType", () => {
        expect(() => proCanonicalDocumentSchema.parse(validBase)).not.toThrow();
    });

    it("rejects header with objectType not in ObjectType enum", () => {
        expect(() =>
            proCanonicalDocumentSchema.parse({
                ...validBase,
                header: { ...validBase.header, objectType: 99 },
            }),
        ).toThrow();
    });

    it("rejects header with frmType not in FRMType enum", () => {
        expect(() =>
            proCanonicalDocumentSchema.parse({
                ...validBase,
                header: { ...validBase.header, frmType: 99 },
            }),
        ).toThrow();
    });

    it("enforces lightRadius domain max", () => {
        expect(() =>
            proCanonicalDocumentSchema.parse({
                ...validBase,
                header: { ...validBase.header, lightRadius: 9 },
            }),
        ).toThrow();
    });
});
