/**
 * Unit tests for BinaryEditorSelectionTracker. The tracker holds per-panel
 * selection state and which panel is active so VSCode commands can resolve
 * "what's selected right now?" without reaching into the webview.
 */

import { describe, expect, it } from "vitest";
import { BinaryEditorSelectionTracker, type BinaryEditorSelection } from "../src/editors/binaryEditor-selectionTracker";

const sel = (overrides: Partial<BinaryEditorSelection> = {}): BinaryEditorSelection => ({
    nodeId: "node-1",
    addable: false,
    removable: false,
    ...overrides,
});

describe("BinaryEditorSelectionTracker", () => {
    it("getActiveSelection returns undefined when nothing is recorded", () => {
        const tracker = new BinaryEditorSelectionTracker();
        expect(tracker.getActiveSelection()).toBeUndefined();
    });

    it("records selection but ignores it until a panel is marked active", () => {
        const tracker = new BinaryEditorSelectionTracker();
        tracker.recordSelection("panel-A", sel({ nodeId: "n-1" }));
        expect(tracker.getActiveSelection()).toBeUndefined();
    });

    it("returns the selection of the active panel", () => {
        const tracker = new BinaryEditorSelectionTracker();
        tracker.recordSelection("panel-A", sel({ nodeId: "n-1", addable: true, arrayPath: ["Global Variables"] }));
        tracker.recordActive("panel-A", true);

        const active = tracker.getActiveSelection();
        expect(active).toBeDefined();
        expect(active!.nodeId).toBe("n-1");
        expect(active!.arrayPath).toEqual(["Global Variables"]);
    });

    it("switches active panel when another panel becomes active", () => {
        const tracker = new BinaryEditorSelectionTracker();
        tracker.recordSelection("panel-A", sel({ nodeId: "a" }));
        tracker.recordSelection("panel-B", sel({ nodeId: "b" }));
        tracker.recordActive("panel-A", true);
        tracker.recordActive("panel-B", true);
        expect(tracker.getActiveSelection()?.nodeId).toBe("b");
    });

    it("clears active panel when its view becomes inactive", () => {
        const tracker = new BinaryEditorSelectionTracker();
        tracker.recordSelection("panel-A", sel({ nodeId: "a" }));
        tracker.recordActive("panel-A", true);
        tracker.recordActive("panel-A", false);
        expect(tracker.getActiveSelection()).toBeUndefined();
    });

    it("does not clear active when an unrelated panel reports inactive", () => {
        const tracker = new BinaryEditorSelectionTracker();
        tracker.recordSelection("panel-A", sel({ nodeId: "a" }));
        tracker.recordActive("panel-A", true);
        tracker.recordActive("panel-B", false);
        expect(tracker.getActiveSelection()?.nodeId).toBe("a");
    });

    it("forgetPanel drops the panel's state and clears active if needed", () => {
        const tracker = new BinaryEditorSelectionTracker();
        tracker.recordSelection("panel-A", sel({ nodeId: "a" }));
        tracker.recordActive("panel-A", true);
        tracker.forgetPanel("panel-A");
        expect(tracker.getActiveSelection()).toBeUndefined();

        // After re-activation reporting on the forgotten panel, no selection surfaces
        // (recordActive alone does not bring back a dropped selection).
        tracker.recordActive("panel-A", true);
        expect(tracker.getActiveSelection()).toBeUndefined();
    });

    it("recordSelection(undefined) clears the panel's selection without touching active state", () => {
        const tracker = new BinaryEditorSelectionTracker();
        tracker.recordSelection("panel-A", sel({ nodeId: "a" }));
        tracker.recordActive("panel-A", true);
        tracker.recordSelection("panel-A", undefined);
        expect(tracker.getActiveSelection()).toBeUndefined();
    });
});
