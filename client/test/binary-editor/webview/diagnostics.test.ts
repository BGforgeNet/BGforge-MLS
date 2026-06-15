import { describe, expect, it } from "vitest";
import { diagnosticsByNode, bannerSummary } from "../../../src/binary-editor/webview/state/diagnostics";

const diags = [
    { nodeId: "0/3", severity: "warning" as const, message: "a" },
    { nodeId: "0/3", severity: "warning" as const, message: "b" },
    { nodeId: "", severity: "warning" as const, message: "c" },
];

describe("diagnostics helpers", () => {
    it("groups diagnostics by node id", () => {
        expect(diagnosticsByNode(diags).get("0/3")?.length).toBe(2);
    });
    it("summarizes the banner by severity", () => {
        expect(bannerSummary(diags)).toBe("3 warnings");
        expect(bannerSummary([...diags, { nodeId: "", severity: "error" as const, message: "e" }])).toBe(
            "3 warnings, 1 error",
        );
    });
    it("summary is empty string for no diagnostics", () => {
        expect(bannerSummary([])).toBe("");
    });
});
