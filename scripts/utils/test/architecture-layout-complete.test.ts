/**
 * The Repository Layout table in docs/architecture.md names every top-level directory, and only real ones.
 *
 * The table is the orientation map, so a new top-level package that never lands in it is invisible to a reader
 * starting there, and a removed one lingers as a pointer to nothing. Hidden directories (`.github/`, `.vscode/`)
 * are tooling, not layout, and are not required.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SPAWN_TIMEOUT_MS } from "../../../shared/spawn-timeout.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

const topLevelDirs = [
    ...new Set(
        execSync("git ls-files", { cwd: REPO_ROOT, encoding: "utf8", timeout: SPAWN_TIMEOUT_MS })
            .split("\n")
            .filter((file) => file.includes("/"))
            .map((file) => file.slice(0, file.indexOf("/"))),
    ),
]
    .filter((dir) => !dir.startsWith("."))
    .sort();

const doc = fs.readFileSync(path.join(REPO_ROOT, "docs/architecture.md"), "utf8");
const section = /^## Repository Layout\n([\s\S]*?)^## /m.exec(doc)?.[1] ?? "";
// First column of each table row, which may name several directories (`themes/`, `snippets/`, `resources/`).
const tabled = [
    ...new Set(
        section
            .split("\n")
            .filter((line) => line.startsWith("| `"))
            .flatMap((line) => [...(line.split("|")[1] ?? "").matchAll(/`([^`/]+)\/`/g)].map((m) => m[1] ?? "")),
    ),
].sort();

describe("docs/architecture.md Repository Layout", () => {
    it("finds the section and its table", () => {
        expect(tabled.length).toBeGreaterThan(0);
    });

    it("names every tracked top-level directory", () => {
        expect(topLevelDirs.filter((dir) => !tabled.includes(dir))).toEqual([]);
    });

    it("names no directory that is not tracked", () => {
        expect(tabled.filter((dir) => !topLevelDirs.includes(dir))).toEqual([]);
    });
});
