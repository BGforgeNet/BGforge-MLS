/**
 * Compiling a script that lives in a directory whose name contains a dot.
 *
 * Real compiles, no mocked child process: the defect this covers is in what the forked wrapper does with
 * the working directory it is given, so a test that stubs the fork cannot see it. A mod directory named
 * for its version - `mymod.v2` - is the shape users hit.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ssl_compile, isSslcAvailable } from "../../src/sslc/ssl_compiler";

// The smallest script the compiler accepts: no includes, so nothing but the working directory is in play.
const SCRIPT = "procedure start begin end\n";

let tmpDir: string;

beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bgforge-dotted-"));
});

afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Make a directory with the given name, put the script in it, and compile it there. */
async function compileIn(dirName: string) {
    const dir = path.join(tmpDir, dirName);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "test.ssl"), SCRIPT, "utf-8");
    const outputFileName = path.join(dir, "test.int");
    const result = await ssl_compile({
        cwd: dir,
        inputFileName: "test.ssl",
        outputFileName,
        options: "",
        headersDir: "",
        interactive: false,
    });
    return { ...result, outputFileName };
}

describe.skipIf(!isSslcAvailable())("the WebAssembly compiler's working directory", () => {
    it("compiles in a plain directory", async () => {
        const { returnCode, stderr, outputFileName } = await compileIn("plain");
        expect(stderr).toBe("");
        expect(returnCode).toBe(0);
        expect(fs.existsSync(outputFileName)).toBe(true);
    });

    it("compiles in a directory whose name contains a dot", async () => {
        const { returnCode, stderr, outputFileName } = await compileIn("mymod.v2");
        expect(stderr).toBe("");
        expect(returnCode).toBe(0);
        expect(fs.existsSync(outputFileName)).toBe(true);
    });

    // Why the working directory cannot simply be moved somewhere without a dot: `#include` resolves
    // against it. The header is load-bearing - without it the script does not build - so this fails if the
    // compile ever stops happening where the source lives.
    it("resolves an include against a working directory whose name contains a dot", async () => {
        const dir = path.join(tmpDir, "headers.v2");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "answer.h"), "#define ANSWER (42)\n", "utf-8");
        fs.writeFileSync(
            path.join(dir, "test.ssl"),
            '#include "answer.h"\nprocedure start begin\n  variable x := ANSWER;\nend\n',
            "utf-8",
        );
        const outputFileName = path.join(dir, "test.int");

        const { returnCode, stdout } = await ssl_compile({
            cwd: dir,
            inputFileName: "test.ssl",
            // The include is only expanded when the preprocessor runs, which `-p` is what asks for.
            options: "-q -p -l",
            outputFileName,
            headersDir: "",
            interactive: false,
            timeoutMs: 30000,
        });

        expect(stdout).not.toContain("Can't open include file");
        expect(returnCode).toBe(0);
        expect(fs.existsSync(outputFileName)).toBe(true);
    });
});
