/**
 * Integration tests for the bin CLI.
 * Runs the built bin-cli.js bundle as a child process to verify
 * exit codes, stdout output, and stderr diff reporting.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const CLI = path.resolve("cli/bin/out/bin-cli.js");
const NODE = process.execPath;
const FIXTURES = path.resolve("client/testFixture/proto");
const RP_MAPS = path.resolve("external/fallout/Fallout2_Restoration_Project/data/maps");

/** Run the bin CLI, returning exit code, stdout, stderr. */
function run(...args: string[]): { code: number; stdout: string; stderr: string } {
    try {
        const stdout = execFileSync(NODE, [CLI, ...args], {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
        });
        return { code: 0, stdout, stderr: "" };
    } catch (err: unknown) {
        const e = err as { status: number; stdout: string; stderr: string };
        return { code: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
    }
}

describe("bin CLI integration", () => {
    const tmpDir = path.resolve("tmp/cli-test-bin");

    beforeEach(() => {
        if (!fs.existsSync(CLI)) {
            throw new Error("bin-cli.js not built. Run: pnpm build:bin-cli");
        }
        fs.mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe("stdout mode", () => {
        it("outputs parsed JSON to stdout", () => {
            const proFile = path.join(FIXTURES, "misc", "00000001.pro");
            if (!fs.existsSync(proFile)) return;
            const { code, stdout } = run(proFile);
            expect(code).toBe(0);
            // Output should be valid JSON
            const parsed = JSON.parse(stdout);
            expect(parsed).toBeDefined();
        });

        it("outputs JSON with trailing newline", () => {
            const proFile = path.join(FIXTURES, "misc", "00000001.pro");
            if (!fs.existsSync(proFile)) return;
            const { stdout } = run(proFile);
            expect(stdout.endsWith("\n")).toBe(true);
        });
    });

    describe("check mode", () => {
        it("exits 0 when JSON snapshot matches", () => {
            const proFile = path.join(FIXTURES, "misc", "00000001.pro");
            const jsonFile = path.join(FIXTURES, "misc", "00000001.pro.json");
            if (!fs.existsSync(proFile) || !fs.existsSync(jsonFile)) return;

            const tmpPro = path.join(tmpDir, "match.pro");
            const tmpJson = path.join(tmpDir, "match.pro.json");
            fs.copyFileSync(proFile, tmpPro);
            fs.copyFileSync(jsonFile, tmpJson);

            const { code } = run(tmpPro, "--check");
            expect(code).toBe(0);
        });

        it("exits 1 when JSON snapshot is stale (returns 'changed')", () => {
            const proFile = path.join(FIXTURES, "misc", "00000001.pro");
            if (!fs.existsSync(proFile)) return;

            // Copy .pro to temp, create stale .json
            const tmpPro = path.join(tmpDir, "test.pro");
            const tmpJson = path.join(tmpDir, "test.pro.json");
            fs.copyFileSync(proFile, tmpPro);
            fs.writeFileSync(tmpJson, '{"stale": true}\n');

            const { code, stderr } = run(tmpPro, "--check");
            expect(code).toBe(1);
            expect(stderr).toContain("DIFF:");
        });

        it("shows line-by-line diff on stderr for stale snapshot", () => {
            const proFile = path.join(FIXTURES, "misc", "00000001.pro");
            if (!fs.existsSync(proFile)) return;

            const tmpPro = path.join(tmpDir, "diff.pro");
            const tmpJson = path.join(tmpDir, "diff.pro.json");
            fs.copyFileSync(proFile, tmpPro);
            fs.writeFileSync(tmpJson, '{"wrong": "content"}\n');

            const { stderr } = run(tmpPro, "--check");
            expect(stderr).toContain("Line ");
            expect(stderr).toContain("    -");
            expect(stderr).toContain("    +");
        });

        it("exits 1 when JSON snapshot is missing", () => {
            const proFile = path.join(FIXTURES, "misc", "00000001.pro");
            if (!fs.existsSync(proFile)) return;

            // Copy .pro to temp without .json
            const tmpPro = path.join(tmpDir, "nojson.pro");
            fs.copyFileSync(proFile, tmpPro);

            const { code, stderr } = run(tmpPro, "--check");
            expect(code).toBe(1);
            expect(stderr).toContain("Missing:");
        });
    });

    describe("save mode", () => {
        it("writes JSON snapshot file", () => {
            const proFile = path.join(FIXTURES, "misc", "00000001.pro");
            if (!fs.existsSync(proFile)) return;

            const tmpPro = path.join(tmpDir, "save.pro");
            fs.copyFileSync(proFile, tmpPro);

            const { code, stdout } = run(tmpPro, "--save");
            expect(code).toBe(0);
            expect(stdout).toContain("Saved:");
            const jsonPath = path.join(tmpDir, "save.pro.json");
            expect(fs.existsSync(jsonPath)).toBe(true);
            // Verify it's valid JSON with trailing newline
            const content = fs.readFileSync(jsonPath, "utf-8");
            expect(content.endsWith("\n")).toBe(true);
            const parsed = JSON.parse(content) as { schemaVersion?: number };
            expect(parsed.schemaVersion).toBe(1);
        });

        it("does not rewrite up-to-date snapshot", () => {
            const proFile = path.join(FIXTURES, "misc", "00000001.pro");
            if (!fs.existsSync(proFile)) return;

            const tmpPro = path.join(tmpDir, "noop.pro");
            fs.copyFileSync(proFile, tmpPro);

            // First save
            run(tmpPro, "--save");
            // Second save should detect no change
            const { code, stdout } = run(tmpPro, "--save");
            expect(code).toBe(0);
            expect(stdout).not.toContain("Saved:");
        });

    });

    describe("error handling", () => {
        it("fails ambiguous MAP parsing by default", () => {
            const mapFile = path.join(RP_MAPS, "sfsheng.map");
            if (!fs.existsSync(mapFile)) return;

            const tmpMap = path.join(tmpDir, "sfsheng-strict.map");
            fs.copyFileSync(mapFile, tmpMap);

            const { code, stderr } = run(tmpMap, "--save");
            expect(code).toBe(1);
            expect(stderr).toContain("overflow");
        });

        it("allows ambiguous MAP parsing with --graceful-map", () => {
            const mapFile = path.join(RP_MAPS, "sfsheng.map");
            if (!fs.existsSync(mapFile)) return;

            const tmpMap = path.join(tmpDir, "sfsheng-graceful.map");
            fs.copyFileSync(mapFile, tmpMap);

            const { code, stdout, stderr } = run(tmpMap, "--save", "--graceful-map");
            expect(code).toBe(0);
            expect(stderr).toBe("");
            expect(stdout).toContain("Saved:");
            expect(fs.existsSync(path.join(tmpDir, "sfsheng-graceful.map.json"))).toBe(true);
        });

        it("saves strict MAP JSON for PRO-dependent object tails without --graceful-map", () => {
            const mapFile = path.join(RP_MAPS, "denbus1.map");
            if (!fs.existsSync(mapFile)) return;

            const tmpMap = path.join(tmpDir, "denbus1.map");
            fs.copyFileSync(mapFile, tmpMap);

            const { code, stdout, stderr } = run(tmpMap, "--save");
            expect(code).toBe(0);
            expect(stderr).toBe("");
            expect(stdout).toContain("Saved:");

            const jsonText = fs.readFileSync(path.join(tmpDir, "denbus1.map.json"), "utf-8");
            const parsed = JSON.parse(jsonText) as {
                opaqueRanges?: Array<{ label: string }>;
            };
            expect(parsed.opaqueRanges?.some((range) => range.label === "objects-tail")).toBe(true);
        });

        it("exits 1 for parse errors in binary", () => {
            const badFile = path.join(FIXTURES, "bad", "too-small.pro");
            if (!fs.existsSync(badFile)) return;
            const { code, stderr } = run(badFile);
            expect(code).toBe(1);
            expect(stderr).toContain("Error parsing");
        });

        it("exits 1 for nonexistent file", () => {
            const { code, stderr } = run("/nonexistent/file.pro");
            expect(code).toBe(1);
            expect(stderr).toContain("Not found");
        });

        it("catches read errors gracefully via safeProcess", () => {
            // Create an unreadable file (if running as non-root)
            const file = path.join(tmpDir, "unreadable.pro");
            fs.writeFileSync(file, "x");
            fs.chmodSync(file, 0o000);

            const { code, stderr } = run(file);
            // Should get error either from parser or read failure
            expect(code).toBe(1);
            expect(stderr.length).toBeGreaterThan(0);

            // Restore permissions for cleanup
            fs.chmodSync(file, 0o644);
        });
    });

    describe("load mode", () => {
        it("converts JSON back to identical binary", () => {
            const proFile = path.join(FIXTURES, "misc", "00000001.pro");
            const jsonFile = path.join(FIXTURES, "misc", "00000001.pro.json");
            if (!fs.existsSync(proFile) || !fs.existsSync(jsonFile)) return;

            const tmpJson = path.join(tmpDir, "load.json");
            fs.copyFileSync(jsonFile, tmpJson);

            const { code, stdout } = run(tmpJson, "--load");
            expect(code).toBe(0);
            expect(stdout).toContain("Wrote:");

            const tmpPro = path.join(tmpDir, "load.pro");
            expect(fs.existsSync(tmpPro)).toBe(true);

            const original = fs.readFileSync(proFile);
            const recreated = fs.readFileSync(tmpPro);
            expect(original.equals(recreated)).toBe(true);
        });

        it("round-trips all fixture types via JSON", () => {
            const dirs = ["misc", "walls", "tiles", "critters", "scenery", "items"];
            for (const dir of dirs) {
                const dirPath = path.join(FIXTURES, dir);
                if (!fs.existsSync(dirPath)) continue;
                const files = fs.readdirSync(dirPath).filter(f => f.endsWith(".pro.json"));
                for (const jsonFile of files) {
                    const srcJson = path.join(dirPath, jsonFile);
                    const srcPro = path.join(dirPath, jsonFile.replace(/\.pro\.json$/, ".pro"));
                    if (!fs.existsSync(srcPro)) continue;

                    const tmpJson = path.join(tmpDir, jsonFile);
                    fs.copyFileSync(srcJson, tmpJson);
                    const { code } = run(tmpJson, "--load");
                    expect(code).toBe(0);

                    const tmpPro = path.join(tmpDir, jsonFile.replace(/\.pro\.json$/, ".pro"));
                    const original = fs.readFileSync(srcPro);
                    const recreated = fs.readFileSync(tmpPro);
                    expect(original.equals(recreated)).toBe(true);
                }
            }
        });

        it("preserves .map extension when loading MAP JSON back to binary", () => {
            const mapFile = path.join(RP_MAPS, "artemple.map");
            if (!fs.existsSync(mapFile)) return;

            const tmpMap = path.join(tmpDir, "artemple.map");
            fs.copyFileSync(mapFile, tmpMap);

            const saveResult = run(tmpMap, "--save", "--graceful-map");
            expect(saveResult.code).toBe(0);

            const tmpJson = path.join(tmpDir, "artemple.map.json");
            expect(fs.existsSync(tmpJson)).toBe(true);

            const loadResult = run(tmpJson, "--load", "--graceful-map");
            expect(loadResult.code).toBe(0);
            expect(loadResult.stdout).toContain("Wrote:");
            expect(fs.existsSync(path.join(tmpDir, "artemple.map"))).toBe(true);
            expect(fs.existsSync(path.join(tmpDir, "artemple.pro"))).toBe(false);
        });

        it("loads strict MAP JSON with PRO-dependent opaque ranges back to identical bytes", () => {
            const mapFile = path.join(RP_MAPS, "denbus1.map");
            if (!fs.existsSync(mapFile)) return;

            const tmpMap = path.join(tmpDir, "denbus1.map");
            fs.copyFileSync(mapFile, tmpMap);

            const saveResult = run(tmpMap, "--save");
            expect(saveResult.code).toBe(0);

            const tmpJson = path.join(tmpDir, "denbus1.map.json");
            const loadResult = run(tmpJson, "--load");
            expect(loadResult.code).toBe(0);

            const original = fs.readFileSync(mapFile);
            const recreated = fs.readFileSync(tmpMap);
            expect(original.equals(recreated)).toBe(true);
        });

        it("round-trips ambiguous MAP JSON back to identical bytes with opaque ranges", () => {
            const mapFile = path.join(RP_MAPS, "sfsheng.map");
            if (!fs.existsSync(mapFile)) return;

            const tmpMap = path.join(tmpDir, "sfsheng.map");
            fs.copyFileSync(mapFile, tmpMap);

            const saveResult = run(tmpMap, "--save", "--graceful-map");
            expect(saveResult.code).toBe(0);

            const tmpJson = path.join(tmpDir, "sfsheng.map.json");
            const loadResult = run(tmpJson, "--load", "--graceful-map");
            expect(loadResult.code).toBe(0);

            const original = fs.readFileSync(mapFile);
            const recreated = fs.readFileSync(tmpMap);
            expect(original.equals(recreated)).toBe(true);
        });

        it("loads ambiguous MAP JSON without --graceful-map (loader infers from opaque ranges)", () => {
            const mapFile = path.join(RP_MAPS, "sfsheng.map");
            if (!fs.existsSync(mapFile)) return;

            const tmpMap = path.join(tmpDir, "sfsheng.map");
            fs.copyFileSync(mapFile, tmpMap);

            const saveResult = run(tmpMap, "--save", "--graceful-map");
            expect(saveResult.code).toBe(0);

            const tmpJson = path.join(tmpDir, "sfsheng.map.json");
            const loadResult = run(tmpJson, "--load");
            expect(loadResult.code).toBe(0);

            const original = fs.readFileSync(mapFile);
            const recreated = fs.readFileSync(tmpMap);
            expect(original.equals(recreated)).toBe(true);
        });

        it("writes opaque MAP ranges as short hex chunks for readable diffs", () => {
            const mapFile = path.join(RP_MAPS, "sfsheng.map");
            if (!fs.existsSync(mapFile)) return;

            const tmpMap = path.join(tmpDir, "sfsheng.map");
            fs.copyFileSync(mapFile, tmpMap);

            const saveResult = run(tmpMap, "--save", "--graceful-map");
            expect(saveResult.code).toBe(0);

            const tmpJson = path.join(tmpDir, "sfsheng.map.json");
            const jsonText = fs.readFileSync(tmpJson, "utf-8");
            const parsed = JSON.parse(jsonText) as {
                opaqueRanges?: Array<{ label: string; hexChunks: string[] }>;
            };

            const objectsTailRange = parsed.opaqueRanges?.find((range) => range.label === "objects-tail");
            expect(objectsTailRange).toBeDefined();
            expect(objectsTailRange?.hexChunks.length).toBeGreaterThan(0);

            const chunkLines = jsonText
                .split("\n")
                .filter((line) => /^\s+"[0-9a-f]+",?$/.test(line));
            expect(chunkLines.length).toBeGreaterThan(0);
            expect(chunkLines.every((line) => line.length <= 80)).toBe(true);
        });

        it("exits 1 for nonexistent JSON file", () => {
            const { code, stderr } = run("/nonexistent/file.json", "--load");
            expect(code).toBe(1);
            expect(stderr).toContain("Not found");
        });
    });

    describe("directory mode", () => {
        it("requires -r flag", () => {
            const { code, stderr } = run(tmpDir);
            expect(code).toBe(1);
            expect(stderr).toContain("Use -r for recursive");
        });

        it("check mode exits 1 when any snapshot is stale", () => {
            const proFile = path.join(FIXTURES, "misc", "00000001.pro");
            if (!fs.existsSync(proFile)) return;

            const tmpPro = path.join(tmpDir, "a.pro");
            const tmpJson = path.join(tmpDir, "a.pro.json");
            fs.copyFileSync(proFile, tmpPro);
            fs.writeFileSync(tmpJson, '{"stale": true}\n');

            const { code } = run(tmpDir, "-r", "--check", "-q");
            expect(code).toBe(1);
        });

        it("check mode exits 0 when all snapshots match", () => {
            const proFile = path.join(FIXTURES, "misc", "00000001.pro");
            if (!fs.existsSync(proFile)) return;

            const tmpPro = path.join(tmpDir, "ok.pro");
            fs.copyFileSync(proFile, tmpPro);
            // Save first to create matching snapshot
            run(tmpPro, "--save");

            const { code } = run(tmpDir, "-r", "--check", "-q");
            expect(code).toBe(0);
        });
    });
});
