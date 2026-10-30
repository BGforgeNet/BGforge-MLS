/**
 * Tests for .github/scripts/codeql-open-alerts.sh, the CodeQL workflow step that fails the run while the analysed ref
 * has open CodeQL alerts. A stub `gh` on PATH stands in for the GitHub API: it records its arguments and prints a
 * canned page of the code-scanning alerts response, so the script's own jq formatting and exit codes are what run.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SPAWN_TIMEOUT_MS } from "@bgforge/shared/spawn-timeout.ts";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(REPO_ROOT, ".github", "scripts", "codeql-open-alerts.sh");

function alert(number: number, rule: string, file: string, line: number): object {
    return {
        number,
        rule: { id: rule, name: rule },
        html_url: `https://github.com/o/r/security/code-scanning/${number}`,
        most_recent_instance: { location: { path: file, start_line: line } },
    };
}

let stubDir: string;

beforeEach(() => {
    stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "codeql-open-alerts-"));
});

afterEach(() => {
    fs.rmSync(stubDir, { recursive: true, force: true });
});

/** Install a `gh` that records argv to `args.txt`, prints `body` and exits with `status`. */
function stubGh(body: string, status = 0): void {
    fs.writeFileSync(path.join(stubDir, "body.json"), body);
    const gh = path.join(stubDir, "gh");
    fs.writeFileSync(
        gh,
        `#!/bin/sh\nprintf '%s\\n' "$@" > "${stubDir}/args.txt"\ncat "${stubDir}/body.json"\nexit ${status}\n`,
    );
    fs.chmodSync(gh, 0o755);
}

function run(env: Record<string, string>): { status: number; stdout: string; stderr: string } {
    const proc = spawnSync(SCRIPT, [], {
        env: { ...process.env, PATH: `${stubDir}:${process.env["PATH"] ?? ""}`, ...env },
        encoding: "utf8",
        timeout: SPAWN_TIMEOUT_MS,
    });
    return { status: proc.status ?? -1, stdout: proc.stdout, stderr: proc.stderr };
}

const ENV = { REPO: "o/r", REF: "refs/heads/master", GH_TOKEN: "unused-by-stub" };

describe("codeql-open-alerts.sh", () => {
    it("exits 0 when the ref has no open alerts", () => {
        stubGh("[]");
        expect(run(ENV).status).toBe(0);
    });

    it("queries open CodeQL alerts for the given ref, every page", () => {
        stubGh("[]");
        run(ENV);
        const args = fs.readFileSync(path.join(stubDir, "args.txt"), "utf8").split("\n");
        expect(args).toContain("--paginate");
        expect(args).toContain(
            "repos/o/r/code-scanning/alerts?tool_name=CodeQL&state=open&ref=refs/heads/master&per_page=100",
        );
    });

    it("fails and annotates each open alert at its file and line", () => {
        // Two pages, as `gh api --paginate` prints them: one JSON array after another.
        stubGh(
            JSON.stringify([alert(48, "js/redos", "compilers/bcs/src/fields.ts", 12)]) +
                JSON.stringify([alert(49, "js/path-injection", "server/src/a.ts", 7)]),
        );
        const result = run(ENV);
        expect(result.status).toBe(1);
        expect(result.stdout).toContain(
            "::error file=compilers/bcs/src/fields.ts,line=12::CodeQL alert #48 (js/redos): https://github.com/o/r/security/code-scanning/48",
        );
        expect(result.stdout).toContain(
            "::error file=server/src/a.ts,line=7::CodeQL alert #49 (js/path-injection): https://github.com/o/r/security/code-scanning/49",
        );
        expect(result.stderr).toContain("2 open CodeQL alert(s) on refs/heads/master");
    });

    it("fails when the API call fails, rather than reading it as no alerts", () => {
        stubGh("", 3);
        // gh's own status comes through, so a failed query is told apart from the script's "alerts found" 1.
        expect(run(ENV).status).toBe(3);
    });

    it("refuses to run without the ref it should check", () => {
        stubGh("[]");
        const result = run({ ...ENV, REF: "" });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("REF is empty");
    });
});
