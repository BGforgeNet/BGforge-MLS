import { describe, expect, it } from "vitest";
import { getOutputPathForJsonSnapshot, getSnapshotPath } from "../src/parsers/json-snapshot-path";

describe("json-snapshot-path", () => {
    it("appends .json to the source filename", () => {
        expect(getSnapshotPath("/tmp/file.pro")).toBe("/tmp/file.pro.json");
        expect(getSnapshotPath("/tmp/file.map")).toBe("/tmp/file.map.json");
    });

    it("keeps the extension-preserving snapshot path even when no file exists yet", () => {
        expect(getSnapshotPath("/tmp/file.pro")).toBe("/tmp/file.pro.json");
    });

    it("does not fall back to legacy basename.json when only that file exists", () => {
        expect(getSnapshotPath("/tmp/file.pro")).toBe("/tmp/file.pro.json");
    });

    it("returns the extension-preserving snapshot path when present", () => {
        expect(getSnapshotPath("/tmp/file.pro")).toBe("/tmp/file.pro.json");
    });

    it("maps extension-preserving snapshots back to their binary output path", () => {
        expect(getOutputPathForJsonSnapshot("/tmp/file.map.json", "map")).toBe("/tmp/file.map");
        expect(getOutputPathForJsonSnapshot("/tmp/file.pro.json", "pro")).toBe("/tmp/file.pro");
    });
});
