import { describe, expect, it } from "vitest";
import { LossReport } from "@bgforge/image";

describe("LossReport", () => {
    it("starts lossless and records items", () => {
        const r = new LossReport();
        expect(r.lossless).toBe(true);
        r.add("dropped-fps", "fps 10 has no BAM equivalent");
        expect(r.lossless).toBe(false);
        expect(r.has("dropped-fps")).toBe(true);
        expect(r.items).toEqual([{ kind: "dropped-fps", detail: "fps 10 has no BAM equivalent" }]);
    });
});
