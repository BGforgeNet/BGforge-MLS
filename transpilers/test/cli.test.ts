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

const NODE = process.execPath;
const CLI = path.resolve("transpilers", pkg.bin?.fgtp ?? "");

describe("@bgforge/transpile bin entry (fgtp)", () => {
    beforeAll(() => {
        if (!CLI || !fs.existsSync(CLI)) {
            throw new Error(`CLI bin missing at ${CLI}. Check package.json#bin.fgtp and Run: pnpm build:transpile`);
        }
    });

    it("exposes a bin entry named fgtp", () => {
        expect(pkg.bin?.fgtp).toBeTruthy();
    });

    it("exits 0 with usage banner on --help", () => {
        const stdout = execFileSync(NODE, ["--no-warnings", CLI, "--help"], {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
        });
        expect(stdout).toContain("Usage: fgtp");
    });
});
