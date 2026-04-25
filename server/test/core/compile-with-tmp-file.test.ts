import * as fs from "fs";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { abortAllCompiles, compileWithTmpFile } from "../../src/core/compile-with-tmp-file";
import type { NormalizedUri } from "../../src/core/normalized-uri";

describe("abortAllCompiles", () => {
    it("aborts every controller in the map and empties it", () => {
        const map = new Map<NormalizedUri, AbortController>();
        const a = new AbortController();
        const b = new AbortController();
        map.set("file:///a" as NormalizedUri, a);
        map.set("file:///b" as NormalizedUri, b);

        abortAllCompiles(map);

        expect(a.signal.aborted).toBe(true);
        expect(b.signal.aborted).toBe(true);
        expect(map.size).toBe(0);
    });

    it("is a no-op on an empty map", () => {
        const map = new Map<NormalizedUri, AbortController>();
        expect(() => abortAllCompiles(map)).not.toThrow();
        expect(map.size).toBe(0);
    });
});

describe("compileWithTmpFile", () => {
    let dir: string;

    beforeEach(() => {
        fs.mkdirSync("tmp", { recursive: true });
        dir = fs.mkdtempSync(path.join("tmp", ".compile-symlink-"));
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("does not write through a pre-existing symlink at tmpPath", async () => {
        // CodeQL js/insecure-temporary-file: a predictable temp path can be
        // hijacked by a symlink that redirects writes to a sensitive file.
        // Pre-unlinking + atomic create prevents the redirect.
        const sensitive = path.resolve(dir, "sensitive");
        const tmpPath = path.resolve(dir, "tmpfile");
        fs.writeFileSync(sensitive, "ORIGINAL");
        fs.symlinkSync(sensitive, tmpPath);

        await compileWithTmpFile({
            uri: "file:///x" as NormalizedUri,
            tmpPath,
            text: "PAYLOAD",
            activeCompiles: new Map(),
            run: async () => {},
        });

        expect(fs.readFileSync(sensitive, "utf8")).toBe("ORIGINAL");
    });
});
