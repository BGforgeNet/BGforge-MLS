import { expect, test } from "vitest";
import { isWebviewToHost } from "../../src/image-editor/webview/messages";

test("accepts valid messages", () => {
    expect(isWebviewToHost({ type: "ready" })).toBe(true);
    expect(isWebviewToHost({ type: "editMeta", patch: { fps: 10 } })).toBe(true);
    expect(isWebviewToHost({ type: "editMeta", patch: { actionFrame: 2, transparentIndex: 0 } })).toBe(true);
    expect(isWebviewToHost({ type: "setExternalPalette", enabled: true })).toBe(true);
    expect(isWebviewToHost({ type: "saveAs", target: "apng" })).toBe(true);
    expect(isWebviewToHost({ type: "saveAs", target: "bamc" })).toBe(true);
    expect(isWebviewToHost({ type: "saveAs", target: "frm", paletteMode: "nearest" })).toBe(true);
    expect(isWebviewToHost({ type: "import", mode: "append" })).toBe(true);
    expect(isWebviewToHost({ type: "requestCreatures" })).toBe(true);
    expect(isWebviewToHost({ type: "setCreature", resref: "AGNASI" })).toBe(true);
    // null is how the webview clears the choice back to the file's own palette.
    expect(isWebviewToHost({ type: "setCreature", resref: null })).toBe(true);
    expect(isWebviewToHost({ type: "requestFrames", indices: [0, 3] })).toBe(true);
    // The set controls: two picks carrying a value, and the set picker, which carries none because the
    // list it offers is the host's.
    expect(isWebviewToHost({ type: "selectSetAction", resref: "CDMB1G1" })).toBe(true);
    expect(isWebviewToHost({ type: "selectSetArmour", level: 2 })).toBe(true);
    expect(isWebviewToHost({ type: "pickSet" })).toBe(true);
    expect(isWebviewToHost({ type: "runtimeError", message: "boom" })).toBe(true);
});
test("rejects malformed messages", () => {
    expect(isWebviewToHost(null)).toBe(false);
    expect(isWebviewToHost({ type: "editMeta" })).toBe(false);
    expect(isWebviewToHost({ type: "editMeta", patch: { fps: "x" } })).toBe(false);
    expect(isWebviewToHost({ type: "editMeta", patch: { actionFrame: "2" } })).toBe(false);
    expect(isWebviewToHost({ type: "editMeta", patch: { transparentIndex: null } })).toBe(false);
    expect(isWebviewToHost({ type: "saveAs", target: "gif" })).toBe(false);
    expect(isWebviewToHost({ type: "import", mode: "wrong" })).toBe(false);
    expect(isWebviewToHost({ type: "setCreature" })).toBe(false);
    expect(isWebviewToHost({ type: "setCreature", resref: 7 })).toBe(false);
    expect(isWebviewToHost({ type: "requestFrames", indices: ["0"] })).toBe(false);
    expect(isWebviewToHost({ type: "runtimeError" })).toBe(false);
    expect(isWebviewToHost({ type: "somethingElse" })).toBe(false);
});
