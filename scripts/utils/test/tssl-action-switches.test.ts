/**
 * Tests for actions/tssl/scripts/switches.sh: the Action's inputs, as env, against the tssl switches it
 * writes to GITHUB_OUTPUT for run.sh.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { SPAWN_TIMEOUT_MS } from "@bgforge/shared/spawn-timeout.ts";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(REPO_ROOT, "actions", "tssl", "scripts", "switches.sh");

/** The Action's defaults, as action.yml passes them. */
const DEFAULTS = { SSL: "false", INT: "true", OPT: "", SHORT_CIRCUIT: "false", TYPECHECK: "true" };

function switches(inputs: Partial<typeof DEFAULTS>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tssl-switches-"));
    try {
        const output = path.join(dir, "output");
        const proc = spawnSync(SCRIPT, [], {
            env: { ...process.env, ...DEFAULTS, ...inputs, GITHUB_OUTPUT: output },
            encoding: "utf8",
            timeout: SPAWN_TIMEOUT_MS,
        });
        expect(proc.status, proc.stderr).toBe(0);
        return fs.readFileSync(output, "utf8");
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

describe("tssl switches.sh", () => {
    it("passes no switch for the defaults", () => {
        expect(switches({})).toBe("args=\n");
    });

    it("passes --no-typecheck for typecheck: false", () => {
        expect(switches({ TYPECHECK: "false" })).toBe("args=--no-typecheck\n");
    });
});
