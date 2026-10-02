/**
 * The one way a language feature reads another workspace file's text: the open buffer when there is one, else
 * the file decoded as every other on-disk read decodes it.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { conlogMock } = vi.hoisted(() => ({ conlogMock: vi.fn() }));
vi.mock("../../src/logger", () => ({ conlog: conlogMock }));

const { readWorkspaceText, readWorkspaceTextSync } = await import("../../src/core/workspace-text");

let dir: string;
beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-text-"));
    conlogMock.mockClear();
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function file(name: string, bytes: Uint8Array): string {
    const abs = path.join(dir, name);
    fs.writeFileSync(abs, bytes);
    return pathToFileURL(abs).toString();
}

const noBuffers = (): undefined => undefined;

describe.each([
    [
        "sync",
        (uri: string, open: (u: string) => string | undefined) => Promise.resolve(readWorkspaceTextSync(uri, open)),
    ],
    ["async", readWorkspaceText],
])("readWorkspaceText (%s)", (_name, read) => {
    it("prefers the open buffer, whose unsaved edits are what the reader sees", async () => {
        const uri = file("a.tp2", Buffer.from("on disk"));
        expect(await read(uri, (u) => (u === uri ? "in the editor" : undefined))).toBe("in the editor");
    });

    // A multi-byte character read one byte per character shifts every position after it on its line.
    it("decodes a UTF-8 file as UTF-8", async () => {
        const uri = file("b.tp2", Buffer.from("\u00E9 x", "utf8"));
        expect(await read(uri, noBuffers)).toBe("\u00E9 x");
    });

    it("decodes a file that is not UTF-8 as windows-1252", async () => {
        const uri = file("c.tp2", Uint8Array.from([0x92, 0x20, 0x78]));
        expect(await read(uri, noBuffers)).toBe("\u2019 x");
    });

    it("answers null for a file it cannot read, and says which", async () => {
        const uri = pathToFileURL(path.join(dir, "missing.tp2")).toString();
        expect(await read(uri, noBuffers)).toBeNull();
        expect(conlogMock).toHaveBeenCalledWith(expect.stringContaining("missing.tp2"), "warn");
    });
});
