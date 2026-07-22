import { expect, test } from "vitest";
import { planImageSave } from "../../src/image-editor/save";

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
