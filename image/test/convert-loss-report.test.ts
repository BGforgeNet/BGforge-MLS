import { describe, expect, it } from "vitest";
import { LossReport } from "@bgforge/image";

describe("LossReport", () => {
    it("starts lossless and records items", () => {
        const r = new LossReport();
        expect(r.lossless).toBe(true);
        r.add("dropped-action-frame", "action frame 2 has no BAM equivalent");
        expect(r.lossless).toBe(false);
        expect(r.has("dropped-action-frame")).toBe(true);
        expect(r.items).toEqual([{ kind: "dropped-action-frame", detail: "action frame 2 has no BAM equivalent" }]);
    });

    it("informational notes (lossless remap, embedded/sidecar palette) are recorded but not counted as loss", () => {
        const r = new LossReport();
        r.add("palette-remapped-to-default", "losslessly remapped to default");
        r.add("embedded-palette", "palette embedded in BAM");
        expect(r.items).toHaveLength(2); // still recorded
        expect(r.lossless).toBe(true); // but nothing was actually lost
        expect(r.losses).toEqual([]);
        r.add("dropped-direction", "dropped a cycle");
        expect(r.lossless).toBe(false);
        expect(r.losses.map((i) => i.kind)).toEqual(["dropped-direction"]); // only the real loss surfaces
    });
});
