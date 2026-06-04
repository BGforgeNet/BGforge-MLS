import { describe, expect, it } from "vitest";
import type { LayoutDescriptor } from "@bgforge/binary-editor";
import { ViewModel } from "../../../src/binary-editor/webview/state/view-model";

const layout: LayoutDescriptor = {
    formatId: "map",
    sections: [
        { id: "0", title: "Header", kind: "form", nodeId: "0" },
        { id: "1", title: "Global Variables", kind: "list", nodeId: "1" },
    ],
};

describe("ViewModel", () => {
    it("defaults the active tab to the first section", () => {
        const vm = new ViewModel(layout);
        expect(vm.activeSection?.id).toBe("0");
    });

    it("switches tabs and reports the active list section namePath for addEntry", () => {
        const vm = new ViewModel(layout);
        vm.selectSection("1");
        expect(vm.activeSection?.kind).toBe("list");
        expect(vm.addEntryNamePath()).toEqual(["Global Variables"]);
    });

    it("returns undefined addEntry target when a form section is active", () => {
        const vm = new ViewModel(layout);
        expect(vm.addEntryNamePath()).toBeUndefined();
    });

    it("toggles expansion as client-side state", () => {
        const vm = new ViewModel(layout);
        expect(vm.isExpanded("0/3")).toBe(false);
        vm.toggleExpanded("0/3");
        expect(vm.isExpanded("0/3")).toBe(true);
        vm.toggleExpanded("0/3");
        expect(vm.isExpanded("0/3")).toBe(false);
    });
});
