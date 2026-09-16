import { expect, test } from "vitest";
import { isWebviewToHost } from "../../src/image-editor/webview/messages";

/** A whole save request, which both the plan and the run carry - see `SaveRequestView`. */
const SAVE_REQUEST = {
    format: "bam",
    bamVersion: 1,
    compressed: false,
    naming: "action-codes",
    prefix: "NEWB",
    targetId: 0x9000,
    section: "monster",
    notes: true,
    destination: "folder",
};

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
    // The creature note's button. A type the guard does not name is refused as a contract mismatch, so
    // adding one to the union alone leaves the button silently dead.
    expect(isWebviewToHost({ type: "openGame" })).toBe(true);
    expect(isWebviewToHost({ type: "setCreature", resref: "AGNASI" })).toBe(true);
    // null is how the webview clears the choice back to the file's own palette.
    expect(isWebviewToHost({ type: "setCreature", resref: null })).toBe(true);
    expect(isWebviewToHost({ type: "requestFrames", indices: [0, 3] })).toBe(true);
    // The set controls: two picks carrying a value, and the set picker, which carries none because the
    // list it offers is the host's.
    expect(isWebviewToHost({ type: "selectSetStance", key: "CDMB1G1#0" })).toBe(true);
    expect(isWebviewToHost({ type: "selectSetArmour", level: 2 })).toBe(true);
    expect(isWebviewToHost({ type: "pickSet" })).toBe(true);
    // The Save As dialog: opening it carries nothing (what it can offer travels with the view), planning
    // carries the chosen layout, and only the run carries the reader's whole choice - which is also the
    // only one that writes anything.
    expect(isWebviewToHost({ type: "beginSaveAs" })).toBe(true);
    // Planning and running carry the SAME request, so what the dialog previewed and what it writes cannot
    // come apart - and whether it is a retarget is derived from it rather than named in it.
    expect(isWebviewToHost({ type: "planSave", request: SAVE_REQUEST })).toBe(true);
    expect(isWebviewToHost({ type: "runSave", request: SAVE_REQUEST })).toBe(true);
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
    expect(isWebviewToHost({ type: "planSave" })).toBe(false);
    // The section decides which target the save resolves to, so one that is not even a string is not a
    // request this acts on.
    expect(isWebviewToHost({ type: "planSave", request: { ...SAVE_REQUEST, section: 12 } })).toBe(false);
    // The id decides what the written declaration and the notes say, so a string that merely looks like
    // one is not a request either.
    expect(isWebviewToHost({ type: "runSave", request: { ...SAVE_REQUEST, targetId: "9000" } })).toBe(false);
    expect(isWebviewToHost({ type: "runSave", request: { ...SAVE_REQUEST, format: "gif" } })).toBe(false);
    expect(isWebviewToHost({ type: "runSave", request: { ...SAVE_REQUEST, destination: "somewhere" } })).toBe(false);
    expect(isWebviewToHost({ type: "somethingElse" })).toBe(false);
});
