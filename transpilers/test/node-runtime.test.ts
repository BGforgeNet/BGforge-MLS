import { describe, expect, test } from "vitest";
import { planNodeShim } from "../common/node-runtime";

// esbuild-wasm's Node build spawns `node <bin/esbuild>` via a bare PATH lookup. planNodeShim
// decides how to make "node" resolve to the host's actual runtime (process.execPath) when the
// host has no `node` on PATH - mirroring what child_process.fork does for the sslc compiler.
describe("planNodeShim", () => {
    test("no-op when node already resolves on PATH", () => {
        const plan = planNodeShim({ hasNode: true, execPath: "/usr/bin/node", platform: "linux" });
        expect(plan).toEqual({ kind: "none" });
    });

    test("prepends the runtime dir when the runtime binary is itself named node (code-server, plain node)", () => {
        const plan = planNodeShim({
            hasNode: false,
            execPath: "/opt/code-server/lib/node",
            platform: "linux",
        });
        expect(plan).toEqual({ kind: "prepend-dir", dir: "/opt/code-server/lib" });
    });

    test("treats node.exe basename as a node runtime on Windows", () => {
        const plan = planNodeShim({
            hasNode: false,
            execPath: "C:\\Program Files\\nodejs\\node.exe",
            platform: "win32",
        });
        expect(plan).toEqual({ kind: "prepend-dir", dir: "C:\\Program Files\\nodejs" });
    });

    test("writes a node shim that re-execs an Electron runtime in node mode (Linux desktop)", () => {
        const plan = planNodeShim({
            hasNode: false,
            execPath: "/opt/vscodium/codium",
            platform: "linux",
        });
        expect(plan.kind).toBe("shim");
        if (plan.kind !== "shim") return;
        expect(plan.filename).toBe("node");
        expect(plan.contents).toContain("ELECTRON_RUN_AS_NODE=1");
        expect(plan.contents).toContain('exec "/opt/vscodium/codium"');
        expect(plan.mode).toBe(0o755);
    });

    test("writes a node.cmd shim for an Electron runtime on Windows", () => {
        const plan = planNodeShim({
            hasNode: false,
            execPath: "C:\\Program Files\\VSCodium\\VSCodium.exe",
            platform: "win32",
        });
        expect(plan.kind).toBe("shim");
        if (plan.kind !== "shim") return;
        expect(plan.filename).toBe("node.cmd");
        expect(plan.contents).toContain("ELECTRON_RUN_AS_NODE=1");
        expect(plan.contents).toContain("VSCodium.exe");
    });
});
