import { describe, expect, it } from "vitest";
import { type IndexedAnimation } from "@bgforge/image";
import { frameFileName, readManifest, sequenceDirId, writeManifest } from "../src/io/manifest.ts";

function makeAnimation(): IndexedAnimation {
    return {
        palette: Array.from({ length: 256 }, () => ({ r: 0, g: 0, b: 0, a: 255 })),
        frames: [
            { width: 1, height: 1, pixels: new Uint8Array([0]), offsetX: 3, offsetY: -2 },
            { width: 1, height: 1, pixels: new Uint8Array([0]), offsetX: 0, offsetY: 0 },
            { width: 1, height: 1, pixels: new Uint8Array([0]), offsetX: 7, offsetY: 5 },
        ],
        sequences: [
            { frameRefs: [0, 1], facing: "NE" },
            { frameRefs: [2], facing: "none" },
        ],
        meta: {
            sourceFormat: "frm",
            fps: 10,
            actionFrame: 2,
            directionLayout: "frm6",
            frmVersion: 4,
            dirOffsetsX: [1, 2, 3, 4, 5, 6],
            dirOffsetsY: [-1, -2, -3, -4, -5, -6],
        },
    };
}

describe("frameFileName", () => {
    it("zero-pads to 3 digits", () => {
        expect(frameFileName(0)).toBe("000.png");
        expect(frameFileName(12)).toBe("012.png");
        expect(frameFileName(999)).toBe("999.png");
    });
});

describe("sequenceDirId", () => {
    it("uses the facing when not none", () => {
        expect(sequenceDirId({ frameRefs: [], facing: "SW" }, 4)).toBe("SW");
    });
    it("falls back to a zero-padded cycle index when facing is none", () => {
        expect(sequenceDirId({ frameRefs: [], facing: "none" }, 0)).toBe("00");
        expect(sequenceDirId({ frameRefs: [], facing: "none" }, 7)).toBe("07");
    });
});

describe("writeManifest", () => {
    it("carries manifestVersion, kind, meta, and per-sequence offsets from the frames", () => {
        const anim = makeAnimation();
        const manifest = writeManifest(anim);

        expect(manifest.manifestVersion).toBe(1);
        expect(manifest.kind).toBe("bgforge-animation");
        expect(manifest.meta).toEqual(anim.meta);
        expect(manifest.sequences).toEqual([
            {
                id: "NE",
                facing: "NE",
                offsets: [
                    [3, -2],
                    [0, 0],
                ],
            },
            { id: "01", facing: "none", offsets: [[7, 5]] },
        ]);
    });

    it("omits the palette entirely", () => {
        const manifest = writeManifest(makeAnimation());
        expect("palette" in manifest).toBe(false);
    });
});

describe("readManifest", () => {
    it("round-trips meta and sequences through a JSON serialize/parse cycle", () => {
        const anim = makeAnimation();
        const written = writeManifest(anim);
        // JSON.parse/stringify, not structuredClone: this exercises the actual on-disk wire
        // format (manifest.json), not an in-memory object clone.
        // eslint-disable-next-line unicorn/prefer-structured-clone -- see comment above
        const roundTripped: unknown = JSON.parse(JSON.stringify(written));

        const { meta, sequences } = readManifest(roundTripped);
        expect(meta).toEqual(anim.meta);
        expect(sequences).toEqual(written.sequences);
    });

    it("tolerates unknown extra fields", () => {
        const written = writeManifest(makeAnimation());
        const withExtra = { ...written, futureField: "some-value" };

        const { meta, sequences } = readManifest(withExtra);
        expect(meta).toEqual(written.meta);
        expect(sequences).toEqual(written.sequences);
    });

    it("throws on an unsupported manifestVersion", () => {
        const written = writeManifest(makeAnimation());
        expect(() => readManifest({ ...written, manifestVersion: 2 })).toThrow(/version/i);
    });

    it("throws on a wrong kind", () => {
        const written = writeManifest(makeAnimation());
        expect(() => readManifest({ ...written, kind: "bgforge-something-else" })).toThrow(/kind/i);
    });

    it("throws on malformed sequences", () => {
        const written = writeManifest(makeAnimation());
        expect(() => readManifest({ ...written, sequences: [{ id: "NE", facing: "NE", offsets: "nope" }] })).toThrow();
    });

    it("throws when sequences is not an array", () => {
        const written = writeManifest(makeAnimation());
        expect(() => readManifest({ ...written, sequences: {} })).toThrow();
    });

    it("throws when the manifest itself is not an object", () => {
        expect(() => readManifest("not an object")).toThrow(/must be a JSON object/);
    });

    it("throws when meta is not an object", () => {
        const written = writeManifest(makeAnimation());
        expect(() => readManifest({ ...written, meta: null })).toThrow(/meta is malformed/);
    });

    it.each([
        ["not a record", 5],
        ["missing/wrong-typed id", { id: 5, facing: "NE", offsets: [] }],
        ["invalid facing", { id: "NE", facing: "bogus", offsets: [] }],
    ])("throws when a sequence entry is malformed (%s)", (_label, badSequence) => {
        const written = writeManifest(makeAnimation());
        expect(() => readManifest({ ...written, sequences: [badSequence] })).toThrow(/sequences are malformed/);
    });

    it.each([
        ["sourceFormat", "bogus"],
        ["fps", "not-a-number"],
        ["actionFrame", "not-a-number"],
        ["transparentIndex", "not-a-number"],
        ["directionLayout", "bogus"],
        ["frmVersion", "not-a-number"],
        ["dirOffsetsX", "not-an-array"],
        ["dirOffsetsY", [1, "two", 3]],
    ])("throws when meta.%s is malformed", (field, badValue) => {
        const written = writeManifest(makeAnimation());
        const badMeta = { ...written.meta, [field]: badValue };
        expect(() => readManifest({ ...written, meta: badMeta })).toThrow(/meta is malformed/);
    });
});
