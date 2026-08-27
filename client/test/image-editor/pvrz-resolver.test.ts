import { describe, expect, it } from "vitest";
import { composePvrzResolver } from "../../src/image-editor/pvrz-resolver";

const SIBLING = Uint8Array.from([1, 1, 1]);
const ARCHIVE = Uint8Array.from([2, 2, 2]);

describe("composePvrzResolver", () => {
    it("prefers a sibling file over the game archive", () => {
        // A mod folder's own PVRZ is what the author is editing; the installed copy is the fallback.
        const resolve = composePvrzResolver({
            readSibling: () => SIBLING,
            readGameResource: () => ARCHIVE,
        });

        expect(resolve(1000)).toEqual(SIBLING);
    });

    it("falls back to the game archive when no sibling exists", () => {
        const resolve = composePvrzResolver({
            readSibling: () => undefined,
            readGameResource: () => ARCHIVE,
        });

        expect(resolve(1000)).toEqual(ARCHIVE);
    });

    it("returns undefined when neither source has the page", () => {
        // Undefined, not a blank page: decodeBamV2 turns this into an error naming the resource,
        // which is the only way a missing texture is distinguishable from a transparent frame.
        const resolve = composePvrzResolver({
            readSibling: () => undefined,
            readGameResource: () => undefined,
        });

        expect(resolve(1000)).toBeUndefined();
    });

    it("asks each source for the page's MOS resource name", () => {
        const asked: string[] = [];
        const resolve = composePvrzResolver({
            readSibling: (resource) => {
                asked.push(`sibling:${resource}`);
                return undefined;
            },
            readGameResource: (resource) => {
                asked.push(`game:${resource}`);
                return undefined;
            },
        });

        resolve(1010);

        expect(asked).toEqual(["sibling:MOS1010.PVRZ", "game:MOS1010.PVRZ"]);
    });

    it("does not consult the game when no game is open", () => {
        const resolve = composePvrzResolver({ readSibling: () => undefined });

        expect(resolve(1000)).toBeUndefined();
    });
});
