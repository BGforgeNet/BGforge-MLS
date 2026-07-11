/**
 * Tests for header-defines module: recursive file discovery.
 * Shared cmpStr and findFiles tests are in utils/test/yaml-helpers.test.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { findFile } from "../src/fallout/header-defines.ts";

const TMP_BASE = "tmp";
beforeAll(() => fs.mkdirSync(TMP_BASE, { recursive: true }));

describe("findFile", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(TMP_BASE, ".fallout-test-"));
        fs.mkdirSync(path.join(tmpDir, "sub"), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, "sub", "target.yml"), "data", "utf8");
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true });
    });

    it("finds a file recursively", () => {
        const result = findFile(tmpDir, "target.yml");
        expect(result).toBeDefined();
        expect(path.basename(result!)).toBe("target.yml");
    });

    it("returns undefined when file not found", () => {
        const result = findFile(tmpDir, "nonexistent.yml");
        expect(result).toBeUndefined();
    });
});
