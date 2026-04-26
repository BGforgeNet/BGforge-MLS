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
import { conlog, errorMessage, getErrnoCode } from "./common";

/** Expand leading ~ to the user's home directory. execFile doesn't use a shell, so ~ is not expanded. */
export function expandHome(filePath: string): string {
    if (filePath.startsWith("~/") || filePath === "~") {
        return path.join(os.homedir(), filePath.slice(1));
    }
    return filePath;
}

/** Known wrapper commands that may prefix executable paths in user settings. */
const KNOWN_WRAPPERS = new Set(["wine", "wine64", "mono", "dotnet", "flatpak"]);

/** Windows .cmd/.bat files require shell: true for cp.execFile to work. */
export function needsShell(executablePath: string): boolean {
    const ext = path.extname(executablePath).toLowerCase();
    return ext === ".cmd" || ext === ".bat";
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
 *  timeoutMs defaults to 60 000 ms — long enough for real sslc/weidu compiles on
 *  slow machines, short enough to surface hangs. Node kills the child on timeout
 *  and calls back with err.killed === true + err.signal === "SIGTERM". */
export function runProcess(
    executable: string,
    args: readonly string[],
    cwd: string,
    signal?: AbortSignal,
    timeoutMs = 60_000,
): Promise<{ err: cp.ExecFileException | null; stdout: string }> {
    const shell = needsShell(executable);
    conlog(`${executable} ${args.join(" ")}`);

    return new Promise((resolve) => {
        cp.execFile(
            executable,
            [...args],
            { cwd, shell, signal, timeout: timeoutMs },
            (err, stdout: string, stderr: string) => {
                conlog("stdout: " + stdout);
                if (stderr) {
                    conlog("stderr: " + stderr);
                }
                if (err) {
                    conlog("error: " + err.message);
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
    } catch (err) {
        if (getErrnoCode(err) !== "ENOENT") {
            conlog(`Failed to clean up ${tmpPath}: ${errorMessage(err)}`, "warn");
        }
    }
}
