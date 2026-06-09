import { describe, expect, it } from "vitest";
import type { Diagnostic } from "@bgforge/binary-editor";
import { bannerSummary } from "../src/binary-editor/webview/state/diagnostics";

const d = (severity: Diagnostic["severity"]): Diagnostic => ({ nodeId: "1", severity, message: "x" });

describe("bannerSummary with info", () => {
    it("counts info entries alongside warnings", () => {
        expect(bannerSummary([d("warning"), d("info"), d("info")])).toBe("1 warning, 2 info");
    });
    it("info only", () => {
        expect(bannerSummary([d("info")])).toBe("1 info");
    });
    it("empty stays empty", () => {
        expect(bannerSummary([])).toBe("");
    });
});
