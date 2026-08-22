/**
 * A compile the compiler rejects has to come back.
 *
 * After reporting errors the compiler waits for a keypress unless it was passed `-q`, and it is forked with
 * its streams piped - so that read waits on a pipe nothing ever writes to or closes, and the compile only
 * ends when the wall-clock bound kills it. `-q` is in the default `compileOptions`, which is what has kept
 * this out of sight: it costs a user a minute of nothing happening the moment they edit that setting, and
 * any caller passing its own options walks into it too.
 *
 * Real compiles, no stubbed child: the whole defect is in the stdio the fork is given.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// The compiler logs through the LSP connection, which no test starts.
vi.mock("../../src/logger", () => ({ conlog: vi.fn() }));

import { ssl_compile, isSslcAvailable } from "../../src/sslc/ssl_compiler";

/** Rejected for a reason that survives every optimisation level: the symbol simply is not there. */
const BROKEN = "procedure start begin\n  x := nope;\nend\n";

let tmpDir: string;

beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bgforge-failing-"));
});

afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe.skipIf(!isSslcAvailable())("a compile the compiler rejects", () => {
    /**
     * Bounded well under the production default so a regression reports as a failed assertion in seconds
     * rather than as a suite that appears to have stopped.
     */
    async function compileBroken(options: string) {
        const dir = fs.mkdtempSync(path.join(tmpDir, "case-"));
        fs.writeFileSync(path.join(dir, "broken.ssl"), BROKEN, "utf-8");
        return ssl_compile({
            cwd: dir,
            inputFileName: "broken.ssl",
            outputFileName: path.join(dir, "broken.int"),
            options,
            headersDir: "",
            interactive: false,
            timeoutMs: 8000,
        });
    }

    it("reports the error instead of waiting for a keypress that cannot arrive", async () => {
        const { returnCode, stdout, stderr } = await compileBroken("");

        expect(stderr).not.toContain("timed out");
        expect(stdout).toContain("Undefined symbol");
        expect(returnCode).toBe(1);
    });

    // The same compile with the option the defaults carry. It passed even with the defect, which is the
    // reason this went unnoticed - so it is here to keep the pair honest, not as coverage of its own.
    it("still reports the error when -q is passed", async () => {
        const { returnCode, stdout, stderr } = await compileBroken("-q");

        expect(stderr).not.toContain("timed out");
        expect(stdout).toContain("Undefined symbol");
        expect(returnCode).toBe(1);
    });
});
