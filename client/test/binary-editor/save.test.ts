import { describe, expect, it } from "vitest";
import { planSave, snapshotJsonFrom } from "../../src/binary-editor/save";

const bytes = new Uint8Array([1, 2, 3]);

describe("planSave", () => {
    it("writes only the main file when autoDumpJson is off", () => {
        const writes = planSave({ targetPath: "/x/foo.map", bytes, snapshotJson: "{}", autoDumpJson: false });
        expect(writes.map((w) => w.path)).toEqual(["/x/foo.map"]);
        expect(writes[0]?.bytes).toBe(bytes);
    });

    it("also writes the sidecar at <file>.json when autoDumpJson is on", () => {
        const writes = planSave({ targetPath: "/x/foo.map", bytes, snapshotJson: '{"a":1}', autoDumpJson: true });
        expect(writes.map((w) => w.path)).toEqual(["/x/foo.map", "/x/foo.map.json"]);
        const sidecar = writes[1];
        expect(sidecar).toBeDefined();
        if (!sidecar) return;
        expect(Buffer.from(sidecar.bytes).toString("utf8")).toBe('{"a":1}');
    });
});

describe("snapshotJsonFrom", () => {
    it("returns the snapshot JSON from a snapshot reply", () => {
        expect(snapshotJsonFrom({ type: "snapshot", json: '{"a":1}' })).toBe('{"a":1}');
    });

    it("throws the worker's message on an error reply instead of yielding an empty sidecar", () => {
        expect(() => snapshotJsonFrom({ type: "error", message: "No format adapter for x" })).toThrow(
            "No format adapter for x",
        );
    });

    it("throws on a reply of the wrong kind", () => {
        expect(() => snapshotJsonFrom({ type: "serialized", bytes: new Uint8Array() })).toThrow(
            "Failed to create JSON snapshot",
        );
    });
});
