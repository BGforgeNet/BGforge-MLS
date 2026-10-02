/**
 * External process invocation helpers used by the SSL and WeiDU compile paths.
 *
 * Kept as a hand-rolled wrapper rather than depending on `execa`/`tinyexec`:
 * the surface here (timeout + AbortSignal + Windows .cmd/.bat shell flag) is
 * small enough that a runtime dep on top of `cp.execFile` would add supply-chain
 * weight without a correctness or capability benefit, and `@bgforge/mls-server`
 * publishes a deliberately lean runtime footprint.
 */

import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { errorMessage, getErrnoCode } from "./diagnostics";
import { conlog } from "./logger";

/** Expand leading ~ to the user's home directory. execFile doesn't use a shell, so ~ is not expanded. */
export function expandHome(filePath: string): string {
    if (filePath.startsWith("~/") || filePath === "~") {
        return path.join(os.homedir(), filePath.slice(1));
    }
    return filePath;
}

/** Known wrapper commands that may prefix executable paths in user settings. */
const KNOWN_WRAPPERS = new Set(["wine", "wine64", "mono", "dotnet", "flatpak"]);

/** Windows .cmd/.bat files cannot be executed directly: cmd.exe runs them. */
export function needsShell(executablePath: string): boolean {
    const ext = path.extname(executablePath).toLowerCase();
    return ext === ".cmd" || ext === ".bat";
}

/** cmd.exe metacharacters; each is escaped with a caret so the shell reads it as text. */
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

/**
 * One argument for a batch file run behind `cmd.exe /d /s /c`: quoted by the Windows argv rules (a quote inside
 * escaped, backslashes before a quote or the end doubled), then its metacharacters caret-escaped twice - once
 * for cmd.exe reading the line, once more for the batch file re-reading it.
 */
export function quoteForBatch(arg: string): string {
    const quoted = `"${arg.replaceAll(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`;
    return quoted.replaceAll(CMD_META, "^$1").replaceAll(CMD_META, "^$1");
}

/**
 * A .cmd/.bat invocation as cmd.exe runs it: one command line, every argument quoted, passed verbatim. Not
 * `shell: true`, which joins an argv array with spaces and no quoting, so a path with a space or an `&` in it
 * split apart or ran as a command (Node reports it as DEP0190).
 */
export function batchInvocation(executable: string, args: readonly string[]): { file: string; args: string[] } {
    const line = [executable.replaceAll(CMD_META, "^$1"), ...args.map((arg) => quoteForBatch(arg))].join(" ");
    return { file: process.env.comspec ?? "cmd.exe", args: ["/d", "/s", "/c", `"${line}"`] };
}

/** How to launch `executable` with `args`: directly, or through cmd.exe for a batch file. */
export function launchOf(
    executable: string,
    args: readonly string[],
): { file: string; args: string[]; windowsVerbatimArguments: boolean } {
    if (!needsShell(executable)) return { file: executable, args: [...args], windowsVerbatimArguments: false };
    return { ...batchInvocation(executable, args), windowsVerbatimArguments: true };
}

/**
 * Split a command-line setting into executable and prefix arguments.
 * Only splits when the first token is a known wrapper (e.g., "wine ~/bin/compile").
 * Plain paths (even with spaces) pass through as-is with tilde expansion.
 * This avoids breaking paths that contain spaces like "/opt/my tools/compile".
 */
export function parseCommandPath(commandPath: string): { executable: string; prefixArgs: string[] } {
    const trimmed = commandPath.trim();
    if (trimmed === "") {
        return { executable: commandPath, prefixArgs: [] };
    }

    const spaceIndex = trimmed.indexOf(" ");
    if (spaceIndex === -1) {
        // Single token, no splitting needed
        return { executable: expandHome(trimmed), prefixArgs: [] };
    }

    const firstToken = trimmed.slice(0, spaceIndex);
    if (KNOWN_WRAPPERS.has(firstToken.toLowerCase())) {
        const rest = trimmed.slice(spaceIndex + 1).trim();
        return {
            executable: firstToken,
            prefixArgs: rest ? [expandHome(rest)] : [],
        };
    }

    // Not a known wrapper - treat entire string as the executable path
    return { executable: expandHome(trimmed), prefixArgs: [] };
}

/** Run an external process and return a promise that resolves when it finishes.
 *  timeoutMs defaults to 60 000 ms - long enough for real sslc/weidu compiles on
 *  slow machines, short enough to surface hangs. Node kills the child on timeout
 *  and calls back with err.killed === true + err.signal === "SIGTERM". */
export function runProcess(
    executable: string,
    args: readonly string[],
    cwd: string,
    signal?: AbortSignal,
    timeoutMs = 60000,
): Promise<{ err: cp.ExecFileException | null; stdout: string }> {
    const launch = launchOf(executable, args);
    conlog(`${executable} ${args.join(" ")}`, "debug");

    return new Promise((resolve) => {
        cp.execFile(
            launch.file,
            launch.args,
            { cwd, signal, timeout: timeoutMs, windowsVerbatimArguments: launch.windowsVerbatimArguments },
            (err, stdout: string, stderr: string) => {
                conlog("stdout: " + stdout, "debug");
                if (stderr) {
                    conlog("stderr: " + stderr, "debug");
                }
                if (err) {
                    // A compiler that ran and exited non-zero has reported the script's errors, which the
                    // diagnostics show; one that could not start, or was killed at the timeout, has failed.
                    const failed = typeof err.code === "string" || err.killed === true;
                    conlog(`error: ${err.message}`, failed ? "error" : "debug");
                }
                resolve({ err, stdout });
            },
        );
    });
}

/** Remove a tmp file, logging errors instead of throwing (cleanup must not mask compiler results). */
export async function removeTmpFile(tmpPath: string) {
    try {
        await fs.promises.unlink(tmpPath);
    } catch (error) {
        if (getErrnoCode(error) !== "ENOENT") {
            conlog(`Failed to clean up ${tmpPath}: ${errorMessage(error)}`, "warn");
        }
    }
}
