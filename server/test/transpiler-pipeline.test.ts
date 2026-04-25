import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTranspiler } from "../../transpilers/common/transpiler-pipeline";

describe("createTranspiler", () => {
    let tempDir: string | undefined;

    afterEach(async () => {
        if (tempDir) {
            await rm(tempDir, { recursive: true, force: true });
        }
        tempDir = undefined;
        vi.restoreAllMocks();
    });

    it("returns a structured output-written event instead of writing to stdout", async () => {
        tempDir = await mkdtemp(join(tmpdir(), "bgforge-mls-pipeline-"));
        const filePath = join(tempDir, "sample.td");
        const uri = `file://${filePath}`;
        const stdoutSpy = vi.spyOn(console, "log").mockImplementation(() => {});

        const transpiler = createTranspiler<string>({
            sourceExtension: ".td",
            targetExtension: ".d",
            name: "TD",
            async transpileCore() {
                return "compiled output";
            },
            getOutput(result) {
                return result;
            },
        });

        const compileResult = await transpiler.compile(uri, "source");

        expect(stdoutSpy).not.toHaveBeenCalled();
        expect(compileResult.events).toEqual([
            {
                level: "info",
                code: "output_written",
                message: `Transpiled to sample.d`,
                outPath: join(tempDir, "sample.d"),
            },
        ]);
        await access(join(tempDir, "sample.d"));
        await expect(readFile(join(tempDir, "sample.d"), "utf8")).resolves.toBe("compiled output");
    });
});
