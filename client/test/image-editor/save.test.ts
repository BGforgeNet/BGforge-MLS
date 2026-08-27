import { expect, test } from "vitest";
import { pvrzPageWrites, planImageSave } from "../../src/image-editor/save";

test("planImageSave writes only the main artifact when no sidecar is given", () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    const writes = planImageSave({ targetPath: "/a/hero.frm", bytes });
    expect(writes).toEqual([{ path: "/a/hero.frm", bytes }]);
});

test("planImageSave appends the sidecar write when one is given", () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    const sidecarBytes = Uint8Array.from([4, 5, 6]);
    const writes = planImageSave({
        targetPath: "/a/hero.frm",
        bytes,
        sidecar: { path: "/a/hero.pal", bytes: sidecarBytes },
    });
    expect(writes).toEqual([
        { path: "/a/hero.frm", bytes },
        { path: "/a/hero.pal", bytes: sidecarBytes },
    ]);
});

test("planImageSave appends each PVRZ page write after the main artifact", () => {
    // A BAM v2 save is N+1 files: the .bam plus every page it re-encoded. The .bam lands first so
    // a crash never leaves fresh pages beside a stale .bam still pointing at the old ones.
    const bytes = Uint8Array.from([1, 2, 3]);
    const page = Uint8Array.from([9, 9]);

    const writes = planImageSave({
        targetPath: "/a/MAPICONS.BAM",
        bytes,
        pages: [{ path: "/a/MOS1000.PVRZ", bytes: page }],
    });

    expect(writes).toEqual([
        { path: "/a/MAPICONS.BAM", bytes },
        { path: "/a/MOS1000.PVRZ", bytes: page },
    ]);
});

test("pvrzPageWrites names each page by its resource name, beside the .bam", () => {
    // A data block addresses a page by number; the file it means is MOS<nnnn>.PVRZ in the same
    // folder, which is where the game's own loader looks for it.
    const bytes = Uint8Array.from([7]);

    const writes = pvrzPageWrites("/game/data/MAPICONS.BAM", [{ page: 4200, bytes }]);

    expect(writes).toEqual([{ path: "/game/data/MOS4200.PVRZ", bytes }]);
});

test("planImageSave writes no page entries when nothing needed re-encoding", () => {
    const bytes = Uint8Array.from([1, 2, 3]);

    expect(planImageSave({ targetPath: "/a/MAPICONS.BAM", bytes, pages: [] })).toEqual([
        { path: "/a/MAPICONS.BAM", bytes },
    ]);
});
