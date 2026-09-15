import { describe, expect, it } from "vitest";
import { readSetManifest, writeSetManifest, type SetManifestV1 } from "@bgforge/animation";

function manifest(overrides: Partial<SetManifestV1> = {}): SetManifestV1 {
    return {
        manifestVersion: 1,
        kind: "bgforge-animation-set",
        source: { id: 0x1234, title: "Ogre", flavour: "bg2ee" },
        members: [
            { resref: "MOGRG1", armour: 1, directory: "MOGRG1" },
            { resref: "MOGRG2", armour: 1, directory: "MOGRG2" },
        ],
        ...overrides,
    };
}

describe("set manifest", () => {
    it("round-trips what an exported set directory declares", () => {
        const written = writeSetManifest({
            source: { id: 0x1234, title: "Ogre", flavour: "bg2ee" },
            members: [
                { resref: "MOGRG1", armour: 1, directory: "MOGRG1" },
                { resref: "MOGRG2", armour: 1, directory: "MOGRG2" },
            ],
        });

        expect(readSetManifest(written)).toEqual(manifest());
    });

    /**
     * The directory is carried rather than derived from the resref: an importer opens the folder this
     * names, so a reader who renames one fixes the manifest instead of the tool guessing at the mapping.
     */
    it("keeps a member's directory apart from its resref", () => {
        const read = readSetManifest(manifest({ members: [{ resref: "MOGRG1", armour: 2, directory: "01-attack" }] }));

        expect(read.members[0]).toEqual({ resref: "MOGRG1", armour: 2, directory: "01-attack" });
    });

    it("refuses a manifest of another kind", () => {
        expect(() => readSetManifest({ ...manifest(), kind: "bgforge-animation" })).toThrow(
            /not an exported animation set/i,
        );
    });

    it("refuses a manifest version it does not know", () => {
        expect(() => readSetManifest({ ...manifest(), manifestVersion: 2 })).toThrow(/manifest version 2/i);
    });

    it("refuses a member list that is not one", () => {
        expect(() => readSetManifest({ ...manifest(), members: [{ resref: "MOGRG1" }] })).toThrow(/member/i);
    });

    /** The whole point of the flavour is that an export from an install that had none is still valid. */
    it("accepts a source that names no install flavour", () => {
        const written = writeSetManifest({
            source: { id: 1, title: "Ogre" },
            members: [{ resref: "A", armour: 1, directory: "A" }],
        });

        expect(readSetManifest(written).source).toEqual({ id: 1, title: "Ogre" });
    });
});
