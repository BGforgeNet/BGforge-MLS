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

    /** A compile whose `run` has started and then waits until released. */
    function heldCompile(map: Map<NormalizedUri, AbortController>, tmpPath: string, text: string) {
        let release!: () => void;
        let started!: () => void;
        const running = new Promise<void>((resolve) => {
            started = resolve;
        });
        const done = compileWithTmpFile({
            uri: "file:///x" as NormalizedUri,
            tmpPath,
            text,
            activeCompiles: map,
            run: () =>
                new Promise<void>((resolve) => {
                    release = resolve;
                    started();
                }),
        });
        return { running, done, release: () => release() };
    }

    it("leaves the newer compile tracked, and its tmp file in place, when a displaced one finishes", async () => {
        const map = new Map<NormalizedUri, AbortController>();
        const tmpPath = path.resolve(dir, "tmpfile");
        const older = heldCompile(map, tmpPath, "OLD");
        await older.running;
        const newer = heldCompile(map, tmpPath, "NEW");
        await newer.running;

        older.release();
        await older.done;

        expect(map.get("file:///x" as NormalizedUri)?.signal.aborted).toBe(false);
        expect(fs.readFileSync(tmpPath, "utf8")).toBe("NEW");

        newer.release();
        await newer.done;

        expect(map.size).toBe(0);
        expect(fs.existsSync(tmpPath)).toBe(false);
    });

    it("still cleans up a compile aborted at shutdown", async () => {
        const map = new Map<NormalizedUri, AbortController>();
        const tmpPath = path.resolve(dir, "tmpfile");
        const run = heldCompile(map, tmpPath, "TEXT");
        await run.running;

        abortAllCompiles(map);
        run.release();
        await run.done;

        expect(fs.existsSync(tmpPath)).toBe(false);
    });
});
