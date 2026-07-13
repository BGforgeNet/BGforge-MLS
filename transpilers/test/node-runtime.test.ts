import { describe, expect, test } from "vitest";
import { planNodeShim } from "../common/node-runtime";

// esbuild-wasm's Node build spawns `node <bin/esbuild>` via a bare PATH lookup. planNodeShim builds
// a `node` shim that re-execs process.execPath, so esbuild uses the extension host's own runtime
// unconditionally - immune to a PATH `node` that is absent OR present-but-broken (a stale shim).
describe("planNodeShim", () => {
    test("Unix: a `node` shim that re-execs execPath in Node mode", () => {
        const shim = planNodeShim({ execPath: "/opt/vscodium/codium", platform: "linux" });
        expect(shim.filename).toBe("node");
        expect(shim.mode).toBe(0o755);
        expect(shim.contents).toContain("#!/bin/sh");
        // ELECTRON_RUN_AS_NODE makes an Electron execPath behave as node; a real node ignores it.
        expect(shim.contents).toContain("ELECTRON_RUN_AS_NODE=1");
        expect(shim.contents).toContain('exec "/opt/vscodium/codium" "$@"');
    });

    test("Unix: the same shim shape serves a plain-node execPath (code-server)", () => {
        const shim = planNodeShim({ execPath: "/opt/code-server/lib/node", platform: "linux" });
        expect(shim.filename).toBe("node");
        expect(shim.contents).toContain('exec "/opt/code-server/lib/node" "$@"');
    });

    test("Windows: a node.cmd shim that re-execs execPath in Node mode", () => {
        const shim = planNodeShim({ execPath: "C:\\Program Files\\VSCodium\\VSCodium.exe", platform: "win32" });
        expect(shim.filename).toBe("node.cmd");
        expect(shim.contents).toContain("set ELECTRON_RUN_AS_NODE=1");
        expect(shim.contents).toContain('"C:\\Program Files\\VSCodium\\VSCodium.exe" %*');
    });
});
