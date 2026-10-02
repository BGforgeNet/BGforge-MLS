/**
 * runWeiduBatch: WeiDU can exit 0 after a FATAL ERROR having written nothing, so the exit status alone is not
 * the verdict. A stand-in executable plays WeiDU here, so the check runs without a WeiDU install.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWeiduBatch } from "../src/weidu-binary.ts";

let dir = "";

/** A stand-in WeiDU that prints `output` and exits with `status`. */
function fakeWeidu(name: string, output: string, status: number): string {
    const file = path.join(dir, name);
    fs.writeFileSync(file, `#!/bin/sh\nprintf '%s\\n' '${output}'\nexit ${status}\n`, { mode: 0o755 });
    return file;
}

beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "weidu-batch-"));
});

afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("runWeiduBatch", () => {
    it("returns WeiDU's output when it succeeds", () => {
        expect(runWeiduBatch(fakeWeidu("ok", "Saved a.bcs", 0), ["a.baf"], dir, 5000)).toBe("Saved a.bcs\n");
    });

    it("throws WeiDU's own words on a FATAL ERROR it exited 0 from", () => {
        const weidu = fakeWeidu("fatal", "FATAL ERROR: Parsing.Parse_error", 0);
        expect(() => runWeiduBatch(weidu, ["a.baf"], dir, 5000)).toThrow(/FATAL ERROR: Parsing\.Parse_error/);
    });

    it("throws on a non-zero exit", () => {
        const weidu = fakeWeidu("fail", "ERROR: something", 2);
        expect(() => runWeiduBatch(weidu, ["a.baf"], dir, 5000)).toThrow(/exit 2/);
    });
});
