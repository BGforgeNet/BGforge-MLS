/**
 * Guard: `@types/vscode` stays pinned to the `engines.vscode` floor, never floated by a caret.
 *
 * The extension declares the oldest VS Code it runs on in `engines.vscode`. `@types/vscode` is what
 * decides which API surface the compiler will accept, and the two are independent: a caret range
 * resolves to whatever minor npm published last, so the build happily type-checks calls to APIs that
 * do not exist on the floor VS Code and the extension breaks only at a user's runtime. Pinning the
 * types to the floor turns that into a compile error at the call site instead.
 *
 * Raising the floor is therefore a deliberate two-line change: bump `engines.vscode` everywhere and
 * bump the `@types/vscode` pin to match. A tilde (not an exact version) so patch-level type fixes
 * within the floor minor still install. `pnpm outdated` will keep reporting `@types/vscode` as
 * behind - that is the pin working, not a bump waiting to be applied.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SPAWN_TIMEOUT_MS } from "../../../shared/spawn-timeout.ts";

// Anchored to this file, not cwd: vitest runs this config from the repo root and from scripts/.
const repoRoot = path.resolve(__dirname, "..", "..", "..");

interface Manifest {
    engines?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
}

const manifests = execSync("git ls-files -- '*package.json'", {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: SPAWN_TIMEOUT_MS,
})
    .split("\n")
    .filter(Boolean)
    .map((file) => ({ file, json: JSON.parse(fs.readFileSync(path.join(repoRoot, file), "utf8")) as Manifest }));

const engineFloors = manifests
    .filter(({ json }) => typeof json.engines?.vscode === "string")
    .map(({ file, json }) => ({ file, range: json.engines!.vscode! }));

const typePins = manifests
    .map(({ file, json }) => ({
        file,
        spec: json.dependencies?.["@types/vscode"] ?? json.devDependencies?.["@types/vscode"],
    }))
    .filter((entry): entry is { file: string; spec: string } => entry.spec !== undefined);

/** "^1.91.0" / "~1.91.0" / "1.91.0" -> "1.91". */
function minorOf(spec: string): string {
    const match = /^[~^]?(\d+)\.(\d+)\./.exec(spec);
    if (!match) throw new Error(`unparseable version range: ${spec}`);
    return `${match[1]}.${match[2]}`;
}

describe("@types/vscode is pinned to the engines.vscode floor", () => {
    it("finds both declarations to compare", () => {
        expect(engineFloors.length).toBeGreaterThan(0);
        expect(typePins.length).toBeGreaterThan(0);
    });

    it("declares one engines.vscode floor across the workspace", () => {
        const distinct = [...new Set(engineFloors.map(({ range }) => range))];
        expect(distinct, engineFloors.map(({ file, range }) => `${file}: ${range}`).join("\n")).toHaveLength(1);
    });

    it.each(typePins)("$file pins @types/vscode with a tilde, not a caret", ({ spec }) => {
        // A caret on 1.x spans every future minor, which is the whole failure mode above.
        expect(spec.startsWith("~")).toBe(true);
    });

    it.each(typePins)("$file pins @types/vscode to the engines floor minor", ({ spec }) => {
        expect(minorOf(spec)).toBe(minorOf(engineFloors[0]!.range));
    });
});
