/**
 * transpilers/common/transpiler-pipeline.ts tests: the shared compile()/
 * transpile() orchestration factory (createTranspiler) that TSSL/TBAF/TD
 * build on top of.
 *
 * createTranspiler takes transpileCore as an injected callback and does no
 * bundling/esbuild work itself, so it is exercised directly with a stub
 * config rather than through a real language transpiler.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { pathToFileURL } from "url";
import { createTranspiler } from "../common/transpiler-pipeline";

function makeStub(transpileCore: (filePath: string, text: string) => Promise<string>) {
    return createTranspiler<string>({
        sourceExtension: ".stub",
        targetExtension: ".out",
        name: "Stub",
        transpileCore: (filePath, text) => transpileCore(filePath, text),
        getOutput: (result) => result,
    });
}

describe("validateExtension", () => {
    it("rejects a file whose extension does not match sourceExtension", async () => {
        const stub = makeStub(async (_f, text) => text);
        await expect(stub.transpile("/virtual/foo.wrong", "x")).rejects.toThrow("is not a .stub file");
    });

    it("compile() rejects a mismatched extension before touching the filesystem", async () => {
        const stub = makeStub(async (_f, text) => text);
        await expect(stub.compile(pathToFileURL("/virtual/foo.wrong").toString(), "x")).rejects.toThrow(
            "is not a .stub file",
        );
    });
});

describe("transpile()", () => {
    it("returns transpileCore's result unchanged for a matching extension", async () => {
        const stub = makeStub(async (_f, text) => text.toUpperCase());
        await expect(stub.transpile("/virtual/foo.stub", "hello")).resolves.toBe("HELLO");
    });

    it("wraps a thrown error as a TranspileError carrying the file path", async () => {
        const stub = makeStub(async () => {
            throw new Error("boom");
        });
        await expect(stub.transpile("/virtual/foo.stub", "x")).rejects.toMatchObject({
            name: "TranspileError",
            message: "boom",
            location: { file: "/virtual/foo.stub" },
        });
    });
});

describe("compile()", () => {
    it("writes the output to a sibling file with the target extension and returns an output_written event", async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "transpiler-pipeline-"));
        try {
            const srcPath = path.join(tmp, "foo.stub");
            const stub = makeStub(async (_f, text) => text.toUpperCase());
            const { outPath, result, events } = await stub.compile(pathToFileURL(srcPath).toString(), "hello");
            expect(outPath).toBe(path.join(tmp, "foo.out"));
            expect(result).toBe("HELLO");
            expect(fs.readFileSync(outPath, "utf-8")).toBe("HELLO");
            expect(events).toEqual([
                {
                    level: "info",
                    code: "output_written",
                    message: "Transpiled to foo.out",
                    outPath,
                },
            ]);
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    it("substitutes the target extension case-insensitively for an uppercase source suffix", async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "transpiler-pipeline-"));
        try {
            const srcPath = path.join(tmp, "foo.STUB");
            const stub = makeStub(async (_f, text) => text);
            const { outPath } = await stub.compile(pathToFileURL(srcPath).toString(), "hi");
            expect(outPath).toBe(path.join(tmp, "foo.out"));
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    it("wraps a transpileCore error as a TranspileError instead of writing a file", async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "transpiler-pipeline-"));
        try {
            const srcPath = path.join(tmp, "foo.stub");
            const stub = makeStub(async () => {
                throw new Error("core failed");
            });
            await expect(stub.compile(pathToFileURL(srcPath).toString(), "x")).rejects.toMatchObject({
                name: "TranspileError",
                message: "core failed",
            });
            expect(fs.existsSync(path.join(tmp, "foo.out"))).toBe(false);
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });
});
