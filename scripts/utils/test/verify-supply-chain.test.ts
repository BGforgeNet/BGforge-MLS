/**
 * Tests for scripts/verify-supply-chain.sh.
 * Drives the script against a controlled fixture workflows directory via the
 * WORKFLOWS_DIR override so the test does not depend on the repo's real .github/.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "verify-supply-chain.sh");
const TMP_BASE = path.join(REPO_ROOT, "tmp", "verify-supply-chain-test");

interface RunResult {
    status: number;
    stdout: string;
    stderr: string;
}

function runScript(workflowsDir: string): RunResult {
    const proc = spawnSync(SCRIPT, [], {
        env: { ...process.env, WORKFLOWS_DIR: workflowsDir },
        encoding: "utf8",
    });
    return {
        status: proc.status ?? -1,
        stdout: proc.stdout,
        stderr: proc.stderr,
    };
}

function makeFixture(name: string, files: Record<string, string>): string {
    const dir = path.join(TMP_BASE, name);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    for (const [filename, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(dir, filename), content, "utf8");
    }
    return dir;
}

describe("verify-supply-chain.sh", () => {
    beforeEach(() => fs.mkdirSync(TMP_BASE, { recursive: true }));
    afterEach(() => fs.rmSync(TMP_BASE, { recursive: true, force: true }));

    const validBuildYml = [
        "name: Build",
        "jobs:",
        "  build:",
        "    steps:",
        "      - name: SBOM",
        "        run: pnpm dlx @cyclonedx/cyclonedx-npm@4.2.1 --output-file dist/sbom.cdx.json",
        "  provenance:",
        "    uses: slsa-framework/slsa-github-generator/.github/workflows/generator_generic_slsa3.yml@v2.1.0",
        "",
    ].join("\n");

    it("passes when all four invariants are present", () => {
        const dir = makeFixture("happy", {
            "scorecard.yml": "name: Scorecard\n",
            "codeql.yml": "name: CodeQL\n",
            "build.yml": validBuildYml,
        });
        const r = runScript(dir);
        expect(r.status).toBe(0);
    });

    it("fails when CycloneDX appears only in a comment", () => {
        const dir = makeFixture("cyclonedx-comment", {
            "scorecard.yml": "name: Scorecard\n",
            "codeql.yml": "name: CodeQL\n",
            "build.yml": [
                "name: Build",
                "# Note: cyclonedx is mentioned here but not actually invoked.",
                "jobs:",
                "  provenance:",
                "    uses: slsa-framework/slsa-github-generator/.github/workflows/generator_generic_slsa3.yml@v2.1.0",
                "",
            ].join("\n"),
        });
        const r = runScript(dir);
        expect(r.status).not.toBe(0);
    });

    it("fails when SLSA generator appears only in a comment", () => {
        const dir = makeFixture("slsa-comment", {
            "scorecard.yml": "name: Scorecard\n",
            "codeql.yml": "name: CodeQL\n",
            "build.yml": [
                "name: Build",
                "# See slsa-framework/slsa-github-generator README for context.",
                "jobs:",
                "  build:",
                "    steps:",
                "      - run: pnpm dlx @cyclonedx/cyclonedx-npm@4.2.1",
                "",
            ].join("\n"),
        });
        const r = runScript(dir);
        expect(r.status).not.toBe(0);
    });

    it("fails when scorecard.yml is missing", () => {
        const dir = makeFixture("no-scorecard", {
            "codeql.yml": "name: CodeQL\n",
            "build.yml": validBuildYml,
        });
        const r = runScript(dir);
        expect(r.status).not.toBe(0);
    });

    it("fails when codeql.yml is missing", () => {
        const dir = makeFixture("no-codeql", {
            "scorecard.yml": "name: Scorecard\n",
            "build.yml": validBuildYml,
        });
        const r = runScript(dir);
        expect(r.status).not.toBe(0);
    });
});
