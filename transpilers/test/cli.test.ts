/**
 * Unit test for the bin entry on @bgforge/transpile.
 * Resolves the bin via package.json (the same way npm does after install)
 * and verifies it starts.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import pkg from "../package.json";
import { REPO_ROOT } from "./repo-root";

const NODE = process.execPath;
const CLI = path.join(REPO_ROOT, "transpilers", pkg.bin?.fgtp ?? "");

describe("@bgforge/transpile bin entry (fgtp)", () => {
    beforeAll(() => {
        if (!CLI || !fs.existsSync(CLI)) {
            throw new Error(`CLI bin missing at ${CLI}. Check package.json#bin.fgtp and Run: pnpm build:transpile`);
        }
    });

    it("exposes a bin entry named fgtp pointing to the CLI output file", () => {
        // The bin path must be a non-empty string ending with .js (the bundled output).
        expect(typeof pkg.bin?.fgtp).toBe("string");
        expect(pkg.bin?.fgtp).toMatch(/\.js$/);
    });

    it("exits 0 with usage banner on --help", () => {
        const stdout = execFileSync(NODE, ["--no-warnings", CLI, "--help"], {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
        });
        expect(stdout).toContain("Usage: fgtp");
    });
});
