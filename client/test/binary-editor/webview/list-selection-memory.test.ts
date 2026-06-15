import { afterEach, describe, expect, it } from "vitest";
import {
    clearSelectionMemory,
    recallSelection,
    rememberSelection,
} from "../../../src/binary-editor/webview/state/list-selection-memory";

// The memory is module-level singleton state (one Map per webview), so each test resets it.
afterEach(() => clearSelectionMemory());

describe("list-selection-memory", () => {
    it("recalls the last id remembered for a section key", () => {
        rememberSelection("effects", "0/3");
        expect(recallSelection("effects")).toBe("0/3");
    });

    it("returns undefined for a section that was never remembered", () => {
        expect(recallSelection("never-touched")).toBeUndefined();
    });

    it("keeps each section key's selection independent", () => {
        rememberSelection("priest", "1/0");
        rememberSelection("wizard", "2/0");
        expect(recallSelection("priest")).toBe("1/0");
        expect(recallSelection("wizard")).toBe("2/0");
    });

    it("overwrites a section's selection with the latest id", () => {
        rememberSelection("effects", "0/3");
        rememberSelection("effects", "0/7");
        expect(recallSelection("effects")).toBe("0/7");
    });

    it("clears every section's selection (the `init` lifetime reset)", () => {
        rememberSelection("priest", "1/0");
        rememberSelection("wizard", "2/0");
        clearSelectionMemory();
        expect(recallSelection("priest")).toBeUndefined();
        expect(recallSelection("wizard")).toBeUndefined();
    });
});
