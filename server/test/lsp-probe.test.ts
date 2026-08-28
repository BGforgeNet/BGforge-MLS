/**
 * Behaviour test for the `lsp-probe` dev tool (server/scripts/lsp-probe.mts).
 *
 * The probe answers "what does the server return for this request", and a developer acts on its output. That
 * makes a SILENTLY incomplete answer its worst failure mode: the workspace scan runs in the background after
 * initialize, so a probe that fires its request immediately reports whatever happens to be indexed - for
 * cross-file requests, usually nothing - and prints it with no indication that the index was not ready.
 *
 * Runs the probe the way a developer does, over a temp workspace, and requires a built server bundle
 * (`pnpm build:base:server`), like the stdio smoke test beside it.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const REPO_ROOT = join(__dirname, "..", "..");
const PROBE = join(REPO_ROOT, "server", "scripts", "lsp-probe.mts");
const TSX = join(REPO_ROOT, "node_modules", ".bin", "tsx");

let workspace: string | undefined;

afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
    workspace = undefined;
});

/**
 * A workspace whose symbol is defined in a header and referenced from two scripts - the shape cross-file
 * references exist for. The filler scripts are what make the race deterministic rather than incidental: the
 * scan yields to the event loop once per file, so a probe that does not wait loses to it well before the file
 * count gets interesting.
 */
async function makeWorkspace(fillerCount: number): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "lsp-probe-"));
    await writeFile(join(dir, "global.h"), "#define GVAR_SHARED (1)\n");
    await writeFile(
        join(dir, "main.ssl"),
        `procedure start begin
    if (global_var(GVAR_SHARED) == 1) then begin
    end
end
`,
    );
    await writeFile(
        join(dir, "other.ssl"),
        `procedure start begin
    display_msg(global_var(GVAR_SHARED));
end
`,
    );
    await Promise.all(
        Array.from({ length: fillerCount }, (_, i) =>
            writeFile(join(dir, `filler${i}.ssl`), `procedure start begin\n    display_msg(${i});\nend\n`),
        ),
    );
    return dir;
}

async function runProbe(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync(TSX, [PROBE, ...args], { cwd, maxBuffer: 32 * 1024 * 1024 });
}

describe("lsp-probe", () => {
    it("waits for the workspace scan, so cross-file references are complete", async () => {
        workspace = await makeWorkspace(40);
        // Cursor on GVAR_SHARED in main.ssl (1-based line 2, column 26).
        const { stdout } = await runProbe(
            ["references", join(workspace, "main.ssl"), "2", "26", "--workspace", workspace, "--json"],
            REPO_ROOT,
        );

        // The symbol is referenced from all three real files; only main.ssl is the probed one.
        expect(stdout).toContain("other.ssl");
        expect(stdout).toContain("global.h");
    }, 120_000);

    // The wait is bounded, so on a workspace too big to index inside it the probe still answers - and the whole
    // point of the change is that it must not answer QUIETLY. Driven through the timeout knob rather than a
    // workspace large enough to take 20s, which would be slow and would time out stochastically.
    //
    // `--scan-timeout 0` is now a decision rather than a race: the probe reports that it did not wait, instead
    // of asking whether the scan had happened to finish first. It used to race a 0ms deadline against
    // scanFinished, and on a loaded machine - where the probe's own startup gives the scan time to complete -
    // the settled promise won and no warning was printed, failing this test intermittently in the full gate.
    it("still answers when the scan outlasts the wait, but says the result may be incomplete", async () => {
        workspace = await makeWorkspace(40);
        const { stdout, stderr } = await runProbe(
            [
                "references",
                join(workspace, "main.ssl"),
                "2",
                "26",
                "--workspace",
                workspace,
                "--json",
                "--scan-timeout",
                "0",
            ],
            REPO_ROOT,
        );

        expect(stderr).toMatch(/INCOMPLETE/);
        // The answer itself is still printed - a warning, not a refusal.
        expect(stdout).toContain("main.ssl");
    }, 120_000);
});
