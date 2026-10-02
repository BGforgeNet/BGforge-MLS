/**
 * What a compile run writes to the output channel, and at which level. Every compile runs this, so its command
 * and output are debug detail; a compiler that could not start has failed, and says so as an error.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { conlogMock } = vi.hoisted(() => ({ conlogMock: vi.fn() }));
vi.mock("../src/logger", () => ({ conlog: conlogMock }));

const { runProcess } = await import("../src/process-runner");

const levelsOf = (): string[] => conlogMock.mock.calls.map(([, level]) => level ?? "info");

describe("runProcess logging", () => {
    beforeEach(() => {
        conlogMock.mockClear();
    });

    it("keeps a run that exits non-zero - a script with errors - at debug", async () => {
        const { err } = await runProcess(process.execPath, ["-e", "process.exit(1)"], process.cwd());

        expect(err).not.toBeNull();
        expect(levelsOf()).toEqual(["debug", "debug", "debug"]);
    });

    it("reports a compiler that could not be started as an error", async () => {
        const { err } = await runProcess("/no/such/compiler", [], process.cwd());

        expect(err).not.toBeNull();
        expect(conlogMock).toHaveBeenCalledWith(expect.stringContaining("ENOENT"), "error");
    });
});
