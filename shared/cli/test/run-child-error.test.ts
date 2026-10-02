/**
 * A --jobs child that fails to spawn at all: `spawn` reports it as an `error` event, sometimes followed by a
 * `close`. Needs its own file because the only way to make spawning fail is to replace `spawn` itself.
 */

import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runCli } from "../cli-utils";
import { REPO_ROOT } from "./repo-root";

vi.mock("child_process", async (importOriginal) => {
    const actual = await importOriginal<typeof import("child_process")>();
    return {
        ...actual,
        spawn: vi.fn(() => {
            // oxlint-disable-next-line unicorn/prefer-event-target -- stands in for a Node ChildProcess, an EventEmitter the runner calls `.on` on
            const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), kill: vi.fn() });
            setImmediate(() => {
                child.emit("error", new Error("spawn EACCES"));
                child.emit("close", null);
            });
            return child;
        }),
    };
});

const tmpDir = path.join(REPO_ROOT, "tmp/cli-test-spawn-error");
const originalArgv = process.argv;
const originalExitCode = process.exitCode;

beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "a.txt"), "alpha");
    fs.writeFileSync(path.join(tmpDir, "b.txt"), "beta");
    process.argv = ["node", "cli.js", tmpDir, "-r", "--save", "--jobs", "2"];
});

afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

it("fails the run and names the spawn error once per child", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli({
        args: { target: tmpDir, mode: "save", recursive: true, quiet: true, jobs: 2 },
        extensions: [".txt"],
        description: "test",
        processFile: () => {
            throw new Error("parent must not process files itself when fanning out");
        },
    });

    expect(process.exitCode).toBe(1);
    const written = stderr.mock.calls.map((call: unknown[]) => String(call[0])).join("");
    expect(written.match(/a child process failed: spawn EACCES/g)).toHaveLength(2);
});
