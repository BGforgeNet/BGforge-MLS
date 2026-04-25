/**
 * Smoke tests for CLI entry points.
 *
 * Each release CLI ships as its own published artefact but cannot carry a
 * numeric v8 coverage gate — subprocess instrumentation via child_process
 * does not capture in-process coverage. These tests substitute for a
 * coverage threshold by asserting that each entry point starts, parses
 * flags, and exits cleanly. A broken shebang, missing bundle, or startup
 * crash will fail here before it reaches users.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const NODE = process.execPath;

const CLIS = {
    format: path.resolve("format/out/cli.js"),
    transpile: path.resolve("transpilers/out/cli.js"),
    bin: path.resolve("binary/out/cli.js"),
} as const;

/** Run a CLI with the given arguments and return exit code + stdout. */
function runHelp(cliPath: string): { code: number; stdout: string; stderr: string } {
    const result = spawnSync(NODE, ["--no-warnings", cliPath, "--help"], {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
    });
    return {
        code: result.status ?? 1,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
    };
}

describe("CLI smoke tests — entry-point presence and startup", () => {
    beforeAll(() => {
        const missing = Object.entries(CLIS)
            .filter(([, p]) => !fs.existsSync(p))
            .map(([name]) => name);
        if (missing.length > 0) {
            throw new Error(`CLI bundle(s) not built: ${missing.join(", ")}. Run: pnpm build`);
        }
    });

    describe("format CLI (format-cli.js)", () => {
        it("exits 0 when --help is passed", () => {
            const { code } = runHelp(CLIS.format);
            expect(code).toBe(0);
        });

        it("prints a usage banner to stdout", () => {
            const { stdout } = runHelp(CLIS.format);
            expect(stdout).toContain("Usage: format-cli");
        });
    });

    describe("transpile CLI (transpile.js / fgtp)", () => {
        it("exits 0 when --help is passed", () => {
            const { code } = runHelp(CLIS.transpile);
            expect(code).toBe(0);
        });

        it("prints a usage banner to stdout", () => {
            const { stdout } = runHelp(CLIS.transpile);
            expect(stdout).toContain("Usage: fgtp");
        });
    });

    describe("binary CLI (cli.js / fgbin)", () => {
        it("exits 0 when --help is passed", () => {
            const { code } = runHelp(CLIS.bin);
            expect(code).toBe(0);
        });

        it("prints a usage banner to stdout", () => {
            const { stdout } = runHelp(CLIS.bin);
            expect(stdout).toContain("Usage: fgbin");
        });
    });
});
