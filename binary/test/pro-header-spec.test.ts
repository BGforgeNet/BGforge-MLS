import { describe, it, expect } from "vitest";
import { proCanonicalDocumentSchema } from "../src/pro/canonical-schemas";

describe("proCanonicalDocumentSchema header", () => {
    // All HeaderFlags bits cleared. Default valid base for the strict-shape
    // schema; tests that touch one bit override only that key.
    const validFlags = {
        flat: false,
        noBlock: false,
        multiHex: false,
        noHighlight: false,
        transRed: false,
        transNone: false,
        transWall: false,
        transGlass: false,
        transSteam: false,
        transEnergy: false,
        wallTransEnd: false,
        lightThru: false,
        shootThru: false,
    };
    const validBase = {
        header: {
            objectType: 5, // Misc
            objectId: 0,
            textId: 0,
            frmType: 5, // matches Misc objectType
            frmId: 0,
            lightRadius: 0,
            lightIntensity: 0,
            flags: validFlags,
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
