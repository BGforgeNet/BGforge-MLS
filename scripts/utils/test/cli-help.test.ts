/**
 * Every CLI this repo publishes names itself in its own `--help`, exactly once.
 *
 * Both halves shipped. `fgfmt` announced itself as `format-cli`, a name no package.json declares and
 * nothing on a user's PATH answers to. And the shared `parseCliArgs` registered its help text with cac
 * AND printed a copy itself, so all four CLIs built on it emitted the text twice - the cac copy with a
 * colon appended, because cac renders a section as `${title}:\n${body}`.
 *
 * The CLIs are discovered from the `bin` field rather than listed, so a package is covered the day it
 * declares one. This runs from scripts/vitest.cli.config.ts, after the bundles are built.
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { SPAWN_TIMEOUT_MS } from "../../../shared/spawn-timeout.ts";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/**
 * The LSP server declares a bin, but it speaks the protocol over stdio and has no `--help` to read:
 * spawning it here would hang until the timeout rather than report anything.
 */
const NOT_A_HELP_CLI = new Set(["@bgforge/mls-server"]);

interface Cli {
    pkg: string;
    binName: string;
    entry: string;
}

function discoverClis(): Cli[] {
    const manifests = execFileSync("git", ["ls-files", "*package.json"], {
        cwd: REPO_ROOT,
        encoding: "utf-8",
        timeout: SPAWN_TIMEOUT_MS,
    })
        .split("\n")
        .filter((p) => p.length > 0 && !p.includes("node_modules/"));

    const clis: Cli[] = [];
    for (const manifest of manifests) {
        const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, manifest), "utf-8")) as {
            name?: string;
            bin?: Record<string, string>;
        };
        if (!pkg.bin || !pkg.name || NOT_A_HELP_CLI.has(pkg.name)) continue;
        for (const [binName, relative] of Object.entries(pkg.bin)) {
            clis.push({
                pkg: pkg.name,
                binName,
                entry: path.join(REPO_ROOT, path.dirname(manifest), relative),
            });
        }
    }
    return clis;
}

const CLIS = discoverClis();

describe("published CLI --help", () => {
    // Discovery through git means a bad glob or a moved manifest would silently test nothing.
    it("finds every packaged CLI", () => {
        expect(CLIS.length).toBeGreaterThanOrEqual(5);
    });

    it.each(CLIS)("$binName names itself once in --help", ({ binName, entry }) => {
        // This suite runs after the build phase by design, so a missing bundle is a failure, not a skip.
        expect(fs.existsSync(entry), `${entry} not built`).toBe(true);

        const stdout = execFileSync(process.execPath, ["--no-warnings", entry, "--help"], {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
            timeout: SPAWN_TIMEOUT_MS,
        });

        // Two copies of the help text is the duplicate-print defect; the colon rode in with it.
        expect(stdout.match(/^Usage:/gm) ?? []).toHaveLength(1);
        expect(/^Usage:\s+(\S+)/m.exec(stdout)?.[1]).toBe(binName);
    });
});
