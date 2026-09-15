/**
 * The TD runtime is found from the plugin's install location in both shipped layouts. Real filesystem, unlike
 * td-plugin.test.ts, which mocks fs and path.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveRuntimePath } from "../src/inject-runtime";

let root: string;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "td-runtime-"));
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function place(rel: string): string {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "");
    return file;
}

describe("resolveRuntimePath", () => {
    it("finds the runtime in the VSIX layout", () => {
        const runtime = place("server/out/td-runtime.d.ts");
        const pluginDir = path.dirname(place("node_modules/bgforge-td-plugin/index.js"));
        expect(resolveRuntimePath(pluginDir)).toEqual({ path: runtime, exists: true });
    });

    it("finds the runtime beside the plugin in the @bgforge/mls-server package", () => {
        const runtime = place("node_modules/@bgforge/mls-server/out/td-runtime.d.ts");
        const pluginDir = path.dirname(place("node_modules/@bgforge/mls-server/out/td-plugin.js"));
        expect(resolveRuntimePath(pluginDir)).toEqual({ path: runtime, exists: true });
    });

    it("reports a missing runtime", () => {
        const pluginDir = path.dirname(place("node_modules/@bgforge/mls-server/out/td-plugin.js"));
        expect(resolveRuntimePath(pluginDir).exists).toBe(false);
    });
});
