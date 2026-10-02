/**
 * Guard: every package's LICENSE.txt is the repository's own, byte for byte.
 *
 * npm packs a package from its own directory, so a published package carries a copy of the root licence
 * rather than a pointer to it - and a copy edited, or left behind when the root changes, ships a licence the
 * repository does not grant.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SPAWN_TIMEOUT_MS } from "@bgforge/shared/spawn-timeout.ts";

// Anchored to this file, not cwd: vitest runs this config from the repo root and from scripts/.
const root = path.resolve(__dirname, "..", "..", "..");
const rootLicense = fs.readFileSync(path.join(root, "LICENSE.txt"), "utf8");

const copies = execSync("git ls-files -- '*/LICENSE.txt'", { cwd: root, encoding: "utf8", timeout: SPAWN_TIMEOUT_MS })
    .split("\n")
    .filter(Boolean);

describe("package licence copies", () => {
    it("finds the copies, so a broken listing cannot pass this vacuously", () => {
        expect(copies.length).toBeGreaterThan(3);
    });

    it.each(copies)("%s matches the root LICENSE.txt", (copy) => {
        expect(fs.readFileSync(path.join(root, copy), "utf8") === rootLicense, `${copy} differs from LICENSE.txt`).toBe(
            true,
        );
    });
});
