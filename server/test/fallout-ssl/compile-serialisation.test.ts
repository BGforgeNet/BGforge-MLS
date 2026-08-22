/**
 * Two compiles that share a working directory must not run at the same time.
 *
 * Both the document copy this extension writes and the scratch file the compiler writes while
 * preprocessing are named the same way for every compile in a directory, so two running side by side
 * overwrite each other's intermediate source. What that produces is not a clean failure: the loser reads
 * a file the winner is still writing and reports errors positioned in whatever it happened to read,
 * naming a header the user never touched.
 *
 * The rate is low - a few hundred concurrent compiles in one directory to see it once - so a test that
 * compiles for real and looks for corruption would pass with the defect present. The guard has to be the
 * structural property instead: overlapping, not its consequences.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedUri } from "../../src/core/normalized-uri";
import type { SSLsettings } from "../../src/settings";

vi.mock("../../src/lsp-connection", () => ({
    getConnection: () => ({
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
        window: {
            showInformationMessage: vi.fn(),
            showWarningMessage: vi.fn(),
            showErrorMessage: vi.fn(),
        },
    }),
    // No document is open: the compiler reports against the file on disk, and nothing here asserts on
    // diagnostics, only on when each compile held the directory.
    getDocuments: () => ({ get: () => undefined }),
}));

/**
 * Stands in for the compiler subprocess, recording when each run held the working directory.
 *
 * This is the process boundary, not our own logic: the real module forks a child, and what the test needs
 * to observe is exactly the window during which that child owns the directory's scratch files.
 */
const held: { cwd: string; enter: number; exit: number }[] = [];
vi.mock("../../src/sslc/ssl_compiler", () => ({
    isSslcAvailable: () => true,
    ssl_compile: async (opts: { cwd: string }) => {
        const record = { cwd: opts.cwd, enter: performance.now(), exit: 0 };
        held.push(record);
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 20);
        });
        record.exit = performance.now();
        return { returnCode: 0, stdout: "", stderr: "" };
    },
}));

const { compile } = await import("../../src/fallout-ssl/compiler");

/** True when any two recorded runs in the same directory were ever in flight together. */
function overlapsWithin(directory: string): boolean {
    const runs = held.filter((run) => path.resolve(run.cwd) === path.resolve(directory));
    return runs.some((a, i) => runs.some((b, j) => i < j && a.enter < b.exit && b.enter < a.exit));
}

function settingsFor(outputDirectory: string): SSLsettings {
    return {
        compilePath: "",
        compileOptions: "-q -p -l -O2",
        outputDirectory,
        headersDirectory: "",
        compileOnValidate: true,
        compiler: "wasm",
    };
}

describe("concurrent Fallout SSL compiles", () => {
    let root: string;

    beforeEach(() => {
        held.length = 0;
        root = fs.mkdtempSync(path.join(os.tmpdir(), "ssl-serialise-"));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    /** Compiles `names` at once, each in `directory`, and waits for all of them. */
    async function compileTogether(directory: string, names: readonly string[]): Promise<void> {
        fs.mkdirSync(directory, { recursive: true });
        await Promise.all(
            names.map((name) => {
                const file = path.join(directory, `${name}.ssl`);
                fs.writeFileSync(file, "procedure start begin end\n");
                return compile(
                    `file://${file}` as NormalizedUri,
                    settingsFor(directory),
                    false,
                    "procedure start begin end\n",
                );
            }),
        );
    }

    it("does not run two compiles in one directory at the same time", async () => {
        const scripts = path.join(root, "scripts");
        await compileTogether(scripts, ["alpha", "beta", "gamma"]);

        expect(held).toHaveLength(3);
        expect(overlapsWithin(scripts)).toBe(false);
    });

    // Queuing means a compile can be superseded while it is still waiting its turn. Typing fires one per
    // keystroke, so running them anyway would spawn a compiler per abandoned edit and report the oldest
    // answer last.
    it("skips a queued compile that was superseded while it waited", async () => {
        const scripts = path.join(root, "scripts");
        fs.mkdirSync(scripts, { recursive: true });
        const write = (name: string) => {
            const file = path.join(scripts, `${name}.ssl`);
            fs.writeFileSync(file, "procedure start begin end\n");
            return `file://${file}` as NormalizedUri;
        };
        const holder = write("holder");
        const edited = write("edited");

        await Promise.all([
            compile(holder, settingsFor(scripts), false, "procedure start begin end\n"),
            // Both of these queue behind the first; the second displaces the first before it ever runs.
            compile(edited, settingsFor(scripts), false, "procedure start begin end\n").catch(() => {}),
            compile(edited, settingsFor(scripts), false, "procedure start begin end\n"),
        ]);

        expect(held).toHaveLength(2);
    });

    it("still runs compiles in different directories at the same time", async () => {
        const a = path.join(root, "a");
        const b = path.join(root, "b");
        await Promise.all([compileTogether(a, ["one"]), compileTogether(b, ["two"])]);

        expect(held).toHaveLength(2);
        const [first, second] = held;
        expect(first!.enter < second!.exit && second!.enter < first!.exit).toBe(true);
    });
});
