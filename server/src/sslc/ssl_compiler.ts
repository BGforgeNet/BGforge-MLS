/**
 * Built-in SSL compiler using sslc WASM module.
 * Compiles Fallout SSL scripts without requiring external compile.exe.
 */

import path from "node:path";
import fs from "node:fs";
import { conlog } from "../common";
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
}) {
    if (!isSslcAvailable()) {
        const msg = "Built-in SSL compiler not available. Install the sslc-emscripten-noderawfs package or configure an external compiler path in settings.";
        conlog(msg);
        return {
            returnCode: 1,
            stdout: "",
            stderr: msg,
        };
    }

    let cmdArgs = opts.options
        .split(" ")
        .map((s) => s.trim())
        .filter((s) => s);

    if (opts.headersDir) {
        if (cmdArgs.some((s) => s.startsWith("-I"))) {
            if (opts.interactive) {
                showWarning(
                    "Warning: -I switch is used but it will be ignored",
                );
            }
            cmdArgs = cmdArgs.filter((s) => !s.startsWith("-I"));
        }

        const headersDir = path.parse(opts.headersDir);

        cmdArgs.push("-I" + path.join(headersDir.root, headersDir.dir, headersDir.name));
    }

    cmdArgs.push(opts.inputFileName, "-o", opts.outputFileName);

    let p;
    try {
        p = fork(
            COMPILER_MODULE,
            cmdArgs,
            {
                execArgv: [], // Disable Node.js flags like --inspect
                cwd: opts.cwd,
                silent: true,
            },
        );
    } catch (err) {
        // fork() can throw synchronously (e.g. EINVAL on Windows with bad env).
        // Return an error result instead of crashing the server.
        const msg = err instanceof Error ? err.message : String(err);
        conlog(`Built-in compiler fork failed: ${msg}`);
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

    return new Promise<{
        returnCode: number;
        stdout: string;
        stderr: string;
    }>((resolve, _reject) => {
        // Handle fork failures (e.g., ENOENT when compiler module is missing).
        // Without this, the promise would never resolve if fork fails before "close".
        p.on("error", (err) => {
            conlog(`Built-in compiler fork error: ${err.message}`);
            stderr.push(err.message);
        });

        p.on("close", (code) => {
            conlog(
                `Built-in compiler:\n` +
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
            resolve({
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
                opts.signal.addEventListener("abort", () => { if (!p.killed) p.kill(); }, { once: true });
            }
        }
    });
}
