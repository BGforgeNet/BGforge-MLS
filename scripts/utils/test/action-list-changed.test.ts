/**
 * The composite Actions' changed-file listing, run for real against a scratch repository.
 *
 * Its last changed path decided the script's exit status: a path the filter maps to a source that does not
 * exist ends the loop on a failed test, and under errexit the whole listing failed with no message and no
 * outputs. A hand-written `.d` with no `.td` beside it, sorting last, is an ordinary consumer commit.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SPAWN_TIMEOUT_MS } from "@bgforge/shared/spawn-timeout.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const ACTION = path.join(REPO_ROOT, "actions/transpile");

const git = (cwd: string, ...args: string[]): string =>
    spawnSync("git", args, { cwd, encoding: "utf-8", timeout: SPAWN_TIMEOUT_MS }).stdout.trim();

let scratch: string | undefined;
afterEach(() => {
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    scratch = undefined;
});

describe("list-changed.sh", () => {
    it("lists what exists when the last changed path maps to a source that does not", () => {
        scratch = fs.mkdtempSync(path.join(os.tmpdir(), "list-changed-"));
        git(scratch, "init", "-q");
        git(scratch, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "base");
        const base = git(scratch, "rev-parse", "HEAD");
        fs.writeFileSync(path.join(scratch, "a.td"), "x");
        fs.writeFileSync(path.join(scratch, "z.d"), "hand-written, no z.td");
        git(scratch, "add", ".");
        git(scratch, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "change");
        const head = git(scratch, "rev-parse", "HEAD");
        const output = path.join(scratch, "github-output");

        const run = spawnSync("bash", [path.join(ACTION, "scripts/list-changed.sh")], {
            cwd: scratch,
            encoding: "utf-8",
            timeout: SPAWN_TIMEOUT_MS,
            env: {
                ...process.env,
                GITHUB_ACTION_PATH: ACTION,
                GITHUB_OUTPUT: output,
                EVENT_NAME: "push",
                SCAN_PATH: ".",
                BASE_SHA_PUSH: base,
                HEAD_SHA_PUSH: head,
            },
        });

        expect(run.status, run.stderr).toBe(0);
        const outputs = fs.readFileSync(output, "utf-8");
        expect(outputs).toContain("count=1");
        const listFile = /^list=(.*)$/m.exec(outputs)?.[1];
        expect(fs.readFileSync(listFile!, "utf-8").trim()).toBe("a.td");
    });
});
