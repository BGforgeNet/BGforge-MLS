import { expect, test } from "vitest";
import { isWebviewToHost } from "../../src/image-editor/webview/messages";

test("accepts valid messages", () => {
    expect(isWebviewToHost({ type: "ready" })).toBe(true);
    expect(isWebviewToHost({ type: "editMeta", patch: { fps: 10 } })).toBe(true);
    expect(isWebviewToHost({ type: "setExternalPalette", enabled: true })).toBe(true);
    expect(isWebviewToHost({ type: "saveAs", target: "apng" })).toBe(true);
    expect(isWebviewToHost({ type: "saveAs", target: "bamc" })).toBe(true);
    expect(isWebviewToHost({ type: "saveAs", target: "frm", paletteMode: "nearest" })).toBe(true);
    expect(isWebviewToHost({ type: "import", mode: "append" })).toBe(true);
});
test("rejects malformed messages", () => {
    expect(isWebviewToHost(null)).toBe(false);
    expect(isWebviewToHost({ type: "editMeta" })).toBe(false);
    expect(isWebviewToHost({ type: "editMeta", patch: { fps: "x" } })).toBe(false);
    expect(isWebviewToHost({ type: "saveAs", target: "gif" })).toBe(false);
    expect(isWebviewToHost({ type: "import", mode: "wrong" })).toBe(false);
});
