/**
 * The reference sslc compiler, built to WebAssembly and shipped with the extension.
 * Compiles Fallout SSL scripts without requiring external compile.exe.
 */

import path from "node:path";
import fs from "node:fs";
import { conlog } from "../logger";
import { showWarning } from "../user-messages";
import { fork } from "child_process";

const COMPILER_MODULE = path.join(__dirname, "../node_modules/sslc-emscripten-noderawfs/compiler.mjs");

export function isSslcAvailable(): boolean {
    return fs.existsSync(COMPILER_MODULE);
}

export async function ssl_compile(opts: {
    cwd: string;
    inputFileName: string;
    outputFileName: string;
    options: string;
    headersDir: string;
    interactive: boolean;
    signal?: AbortSignal;
    /** Wall-clock timeout in ms. Defaults to 60 000 ms. On expiry the child is
     *  killed and the function resolves with returnCode 1 and a timeout message. */
    timeoutMs?: number;
    /** Gates the per-compile payload dump on "close" (see below). Defaults to false. */
    debug?: boolean;
}) {
    if (!isSslcAvailable()) {
        const msg =
            "The WebAssembly compiler is not available. Install the sslc-emscripten-noderawfs package or configure an external compiler path in settings.";
        conlog(msg);
        return {
            returnCode: 1,
            stdout: "",
            stderr: msg,
        };
    }

    // The WebAssembly compiler's wrapper derives its working directory as `path.join(parse(cwd).dir,
    // parse(cwd).name)`, which drops whatever follows the last dot of the final segment as an "extension" -
    // so it chdirs into a path that does not exist and dies with a bare `ErrnoError undefined undefined`,
    // naming neither the cause nor the directory. Detected by reproducing that computation rather than by
    // looking for a dot, so this stays true if the wrapper's own rule changes.
    //
    // Reported instead of worked around: the cwd cannot move, because the compiler resolves `#include`
    // against it and rejects an absolute input path outright.
    // TODO: drop this whole guard once the built-in back end replaces this one - it runs
    // in-process and has no chdir, so the defect cannot reach it.
    const wrapperCwd = path.parse(opts.cwd);
    if (path.resolve(path.join(wrapperCwd.dir, wrapperCwd.name)) !== path.resolve(opts.cwd)) {
        const msg =
            `The WebAssembly compiler cannot build scripts in a directory whose name contains a dot ` +
            `("${path.basename(opts.cwd)}"). Rename the directory, or set bgforge.falloutSSL.compiler ` +
            `to "built-in", which has no such limit.`;
        conlog(msg);
        return { returnCode: 1, stdout: "", stderr: msg };
    }

    let cmdArgs = opts.options
        .split(" ")
        .map((s) => s.trim())
        .filter(Boolean);

    if (opts.headersDir) {
        if (cmdArgs.some((s) => s.startsWith("-I"))) {
            if (opts.interactive) {
                showWarning("Warning: -I switch is used but it will be ignored");
            }
            cmdArgs = cmdArgs.filter((s) => !s.startsWith("-I"));
        }

        // The directory as configured, not reassembled from `path.parse` parts: rebuilding it from
        // `root + dir + name` drops whatever follows the last dot of the final segment as an "extension",
        // so a headers directory named `headers.v2` or `fo2.rp` silently became `headers` / `fo2` and the
        // include path pointed somewhere that does not exist.
        cmdArgs.push("-I" + path.resolve(opts.headersDir));
    }

    cmdArgs.push(opts.inputFileName, "-o", opts.outputFileName);

    let p;
    try {
        // fork() launches process.execPath - the extension host's own runtime - so, unlike
        // esbuild's internal spawn("node"), this compiler needs no PATH shim. Both of
        // this extension's child-Node spawns follow one invariant: launch via process.execPath,
        // never a bare "node" PATH lookup (esbuild reaches it via ensureNodeOnPath in
        // transpilers/common/node-runtime.ts, which is the documented home of that invariant).
        p = fork(COMPILER_MODULE, cmdArgs, {
            execArgv: [], // Disable Node.js flags like --inspect
            cwd: opts.cwd,
            silent: true,
        });
    } catch (error) {
        // fork() can throw synchronously (e.g. EINVAL on Windows with bad env).
        // Return an error result instead of crashing the server.
        const msg = error instanceof Error ? error.message : String(error);
        conlog(`WebAssembly compiler fork failed: ${msg}`);
        return { returnCode: 1, stdout: "", stderr: msg };
    }

    const stdout: string[] = [];
    const stderr: string[] = [];
    p.stdout?.on("data", (data) => {
        const text = data.toString();
        stdout.push(text);
    });

    p.stderr?.on("data", (data) => {
        const text = data.toString();
        stderr.push(text);
    });

    const timeoutMs = opts.timeoutMs ?? 60000;

    return new Promise<{
        returnCode: number;
        stdout: string;
        stderr: string;
    }>((resolve) => {
        let settled = false;

        function settle(result: { returnCode: number; stdout: string; stderr: string }) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(result);
        }

        // Kill on wall-clock timeout; resolve with an error result.
        const timer = setTimeout(() => {
            const msg = `WebAssembly compiler timed out after ${timeoutMs}ms`;
            conlog(msg);
            if (!p.killed) p.kill();
            settle({ returnCode: 1, stdout: stdout.join(""), stderr: msg });
        }, timeoutMs);

        // Handle fork failures (e.g., ENOENT when compiler module is missing).
        // Without this, the promise would never resolve if fork fails before "close".
        p.on("error", (err) => {
            conlog(`WebAssembly compiler fork error: ${err.message}`);
            stderr.push(err.message);
        });

        p.on("close", (code) => {
            // Full-payload dump, gated behind settings.debug like the sibling
            // provider-side dump (see fallout-ssl/provider.ts resolveSymbol) -
            // opts/cmdArgs/stdout/stderr are not worth an unconditional info-level
            // log on every compile.
            if (opts.debug) {
                conlog(
                    `WebAssembly compiler:\n` +
                        "opts=" +
                        JSON.stringify(opts) +
                        "\n" +
                        "cmdArgs=" +
                        JSON.stringify(cmdArgs) +
                        "\n" +
                        "returnCode=" +
                        code +
                        "\n" +
                        stdout.join("") +
                        "\n" +
                        stderr.join("") +
                        "\n",
                );
            }
            settle({
                returnCode: code !== null ? code : 1, // If code is null, assume error
                stdout: stdout.join(""),
                stderr: stderr.join(""),
            });
        });

        // Kill the child process if the signal is aborted (e.g., newer compile supersedes this one).
        // Must be registered after the "close" listener so that synchronous kills (already-aborted
        // signals) still resolve the promise.
        if (opts.signal) {
            if (opts.signal.aborted) {
                p.kill();
            } else {
                opts.signal.addEventListener(
                    "abort",
                    () => {
                        if (!p.killed) p.kill();
                    },
                    { once: true },
                );
            }
        }
    });
}
