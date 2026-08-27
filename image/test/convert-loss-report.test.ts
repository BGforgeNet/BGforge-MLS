import { describe, expect, it } from "vitest";
import { LossReport } from "@bgforge/image";

describe("LossReport.absorb", () => {
    it("folds another report's items in, so a two-stage conversion warns once", () => {
        const first = new LossReport();
        first.add("colours-quantized", "colours merged");
        const second = new LossReport();
        second.add("padded-sequence", "direction padded");

        first.absorb(second);

        expect(first.has("padded-sequence")).toBe(true);
        expect(first.losses).toHaveLength(2);
    });
});

describe("LossReport", () => {
    it("starts lossless and records items", () => {
        const r = new LossReport();
        expect(r.lossless).toBe(true);
        r.add("padded-sequence", "direction W padded from 2 to 4 frames");
        expect(r.lossless).toBe(false);
        expect(r.has("padded-sequence")).toBe(true);
        expect(r.items).toEqual([{ kind: "padded-sequence", detail: "direction W padded from 2 to 4 frames" }]);
    });

    it("informational notes (lossless remap, embedded/sidecar palette) are recorded but not counted as loss", () => {
        const r = new LossReport();
        r.add("palette-remapped-to-default", "losslessly remapped to default");
        r.add("embedded-palette", "palette embedded in BAM");
        expect(r.items).toHaveLength(2); // still recorded
        expect(r.lossless).toBe(true); // but nothing was actually lost
        expect(r.losses).toEqual([]);
        r.add("empty-direction", "FRM slot NW has no source direction; reused slot 0's sequence");
        expect(r.lossless).toBe(false);
        expect(r.losses.map((i) => i.kind)).toEqual(["empty-direction"]); // only the real loss surfaces
    });
});
