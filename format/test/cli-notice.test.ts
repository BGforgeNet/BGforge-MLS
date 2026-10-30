/**
 * The format CLI writes the formatted output and prints the formatter's notice to stderr: a notice means "formatted,
 * but say this", so the file is saved and the result is the same as without it (the exit code follows from it).
 *
 * The formatter is replaced by one that runs the comment net over a real parsed node with a comment left out: the
 * formatters no longer reach the net on real input, so only a stand-in can make it fire.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initParser, getParser } from "@bgforge/shared/parsers/fallout-ssl";

const SOURCE = "procedure p begin\n    x := a /* c */ + b;\nend\n";
const REBUILT = "procedure p begin\n    x := a + b;\nend\n";

vi.mock("../src/index", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../src/index")>();
    const { reportRescuedComments, restoreLostComments } = await import("../src/format-utils");
    return {
        ...actual,
        formatFalloutSsl: (root: Parameters<typeof actual.formatFalloutSsl>[0]) =>
            reportRescuedComments(() => ({ text: restoreLostComments(root, REBUILT, false, "", false) })),
    };
});

describe("format CLI notice", () => {
    let dir: string;
    let file: string;

    beforeAll(async () => {
        await initParser();
    });

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "fgfmt-notice-"));
        file = path.join(dir, "a.ssl");
        fs.writeFileSync(file, SOURCE);
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it("saves the formatted file and prints the notice to stderr", async () => {
        const { processFile } = await import("../src/cli");
        expect(getParser()).toBeDefined();
        const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
        vi.spyOn(console, "log").mockImplementation(() => undefined);

        const result = await processFile(file, "save");

        expect(result).toBe("changed");
        expect(fs.readFileSync(file, "utf-8")).toContain("/* c */");
        const printed = stderr.mock.calls.map((call) => String(call[0])).join("\n");
        expect(printed).toContain(file);
        expect(printed).toContain("a comment was moved because the formatter would have dropped it");
    });

    it("prints nothing to stderr for a file without a notice", async () => {
        const { processFile } = await import("../src/cli");
        fs.writeFileSync(file, REBUILT);
        const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
        vi.spyOn(console, "log").mockImplementation(() => undefined);

        const result = await processFile(file, "check");

        expect(result).toBe("unchanged");
        expect(stderr).not.toHaveBeenCalled();
    });
});
