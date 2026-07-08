import { describe, expect, it } from "vitest";
import { renderFamily } from "../../shared/dialog-model";

// renderFamily derives the target render family from the single source-language discriminant, so TD renders
// as WeiDU D and TSSL as Fallout SSL without a second stored field that could drift out of sync.
describe("renderFamily", () => {
    it("maps d and td to weidu-d", () => {
        expect(renderFamily("d")).toBe("weidu-d");
        expect(renderFamily("td")).toBe("weidu-d");
    });
    it("maps ssl and tssl to fallout-ssl", () => {
        expect(renderFamily("ssl")).toBe("fallout-ssl");
        expect(renderFamily("tssl")).toBe("fallout-ssl");
    });
});
