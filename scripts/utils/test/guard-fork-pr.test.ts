/**
 * Tests for actions/_shared/guard-fork-pr.sh.
 * Spawns the script directly with EVENT_NAME/IS_FORK env combinations and asserts the exit code:
 * the guard fires (blocks) with a non-zero exit on a fork-controlled pull_request/pull_request_target,
 * and exits 0 (lets the caller proceed) otherwise.
 *
 * Also covers the composite action.yml files: they have no local runtime harness, so a cheap string
 * check guards against the guard step regressing to running unconditionally in check mode (it must
 * only ever push in save mode, so it has nothing to guard against when check=true).
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(REPO_ROOT, "actions", "_shared", "guard-fork-pr.sh");

function runGuard(eventName: string, isFork: string): number {
    const proc = spawnSync(SCRIPT, [], {
        env: { ...process.env, EVENT_NAME: eventName, IS_FORK: isFork },
        encoding: "utf8",
    });
    return proc.status ?? -1;
}

describe("guard-fork-pr.sh", () => {
    it("blocks a fork pull_request", () => {
        expect(runGuard("pull_request", "true")).toBe(1);
    });

    it("blocks a fork pull_request_target", () => {
        expect(runGuard("pull_request_target", "true")).toBe(1);
    });

    it("allows a fork push event", () => {
        expect(runGuard("push", "true")).toBe(0);
    });

    it("allows a same-repo pull_request", () => {
        expect(runGuard("pull_request", "false")).toBe(0);
    });
});

describe("action.yml guard step is skipped in check mode", () => {
    const actionDirs = ["binary", "format", "transpile"];

    it.each(actionDirs)("%s/action.yml gates the guard step on inputs.check", (dir) => {
        const actionYml = fs.readFileSync(path.join(REPO_ROOT, "actions", dir, "action.yml"), "utf8");
        const guardStepIndex = actionYml.indexOf("Guard against fork pull_request");
        expect(guardStepIndex).toBeGreaterThan(-1);
        const nextStepIndex = actionYml.indexOf("- name:", guardStepIndex + 1);
        const guardStepBlock = actionYml.slice(guardStepIndex, nextStepIndex === -1 ? undefined : nextStepIndex);
        expect(guardStepBlock).toContain("if: inputs.check != 'true'");
    });
});
