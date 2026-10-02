/**
 * A .cmd/.bat compiler runs through cmd.exe, which reads one command line - not an argv array. Every argument
 * has to arrive quoted and escaped, or a path with a space or an `&` in it splits apart or runs as a command.
 * The quoting is asserted as text here; no Windows machine runs these.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));
vi.mock("child_process", async (importOriginal) => ({
    ...(await importOriginal<typeof import("child_process")>()),
    execFile: execFileMock,
}));
vi.mock("../src/logger", () => ({ conlog: vi.fn() }));

const { batchInvocation, quoteForBatch, runProcess } = await import("../src/process-runner");

describe("quoteForBatch", () => {
    it("quotes a path with a space and an ampersand so cmd.exe and the batch file both read it as one", () => {
        expect(quoteForBatch("C:\\my dir\\a&b.ssl")).toBe('^^^"C:\\my^^^ dir\\a^^^&b.ssl^^^"');
    });

    it("keeps an embedded quote inside its argument", () => {
        expect(quoteForBatch('say "hi"')).toBe('^^^"say^^^ \\^^^"hi\\^^^"^^^"');
    });

    it("doubles backslashes that end an argument, so they do not escape its closing quote", () => {
        expect(quoteForBatch("C:\\out\\")).toBe('^^^"C:\\out\\\\^^^"');
    });
});

describe("runProcess with a batch-file compiler", () => {
    beforeEach(() => {
        execFileMock.mockReset();
    });

    it("runs it through cmd.exe with the quoted line passed verbatim, never shell: true", async () => {
        execFileMock.mockImplementation((_file, _args, _options, callback) => callback(null, "", ""));

        await runProcess("C:\\tools\\compile.cmd", ["-I", "C:\\my dir"], "C:\\work");

        const [file, args, options] = execFileMock.mock.calls[0]!;
        const expected = batchInvocation("C:\\tools\\compile.cmd", ["-I", "C:\\my dir"]);
        expect([file, args]).toEqual([expected.file, expected.args]);
        expect(options).toMatchObject({ windowsVerbatimArguments: true });
        expect(options).not.toHaveProperty("shell", true);
    });
});
