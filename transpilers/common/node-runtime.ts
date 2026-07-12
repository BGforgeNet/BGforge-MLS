/**
 * Make esbuild-wasm's child-process spawn find a Node runtime on hosts that have none.
 *
 * esbuild-wasm's Node build never runs the WASM in-process - `initialize` rejects the
 * `wasmModule` option outside the browser - so every bundle spawns `node <bin/esbuild>`
 * via a bare PATH lookup (esbuild-wasm lib/main.js). VS Code and VSCodium ship an Electron
 * runtime, not a `node` binary on PATH, so a user without a system Node install hits
 * `spawn node ENOENT` and the bundler dies. The built-in sslc compiler avoids this by using
 * child_process.fork, which launches process.execPath (the extension host's own runtime)
 * rather than resolving "node". We cannot change esbuild's spawn, but we can make "node"
 * resolve to process.execPath by pointing PATH at it - applied ONLY when "node" is not
 * already resolvable, so a host that already has Node is left untouched (zero regression).
 *
 * Extension-wide invariant (this module is its documented home): every child Node process
 * launches via process.execPath - the runtime already executing our code - never a bare
 * "node" PATH lookup the host may not satisfy. sslc gets this from child_process.fork's
 * default (server/src/sslc/ssl_compiler.ts); esbuild's dep-internal spawn gets it from
 * ensureNodeOnPath below.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/** A decision about how to make `node` resolve; pure, so it is unit-testable. */
export type NodeShimPlan =
    | { readonly kind: "none" }
    | { readonly kind: "prepend-dir"; readonly dir: string }
    | { readonly kind: "shim"; readonly filename: string; readonly contents: string; readonly mode: number };

/**
 * Decide how to expose `node` for esbuild's child spawn given the host runtime.
 *
 * - Node already on PATH -> nothing to do.
 * - The runtime binary is itself named `node`/`node.exe` (code-server, plain Node hosts)
 *   -> prepend its directory to PATH; no file needs writing.
 * - Otherwise it is an Electron runtime (VS Code/VSCodium desktop) -> write a tiny `node`
 *   shim that re-execs it with ELECTRON_RUN_AS_NODE=1 so it behaves as plain Node.
 */
export function planNodeShim(input: {
    readonly hasNode: boolean;
    readonly execPath: string;
    readonly platform: NodeJS.Platform;
}): NodeShimPlan {
    if (input.hasNode) return { kind: "none" };

    // Parse execPath with the target platform's path rules, not the host's - this function
    // is pure and unit-tested cross-platform, so a Windows path must split on backslashes
    // even when the test runs on Linux.
    const p = input.platform === "win32" ? path.win32 : path.posix;
    const base = p.basename(input.execPath).toLowerCase();
    if (base === "node" || base === "node.exe") {
        return { kind: "prepend-dir", dir: p.dirname(input.execPath) };
    }

    if (input.platform === "win32") {
        return {
            kind: "shim",
            filename: "node.cmd",
            contents: `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${input.execPath}" %*\r\n`,
            mode: 0o755,
        };
    }
    return {
        kind: "shim",
        filename: "node",
        contents: `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${input.execPath}" "$@"\n`,
        mode: 0o755,
    };
}

/** True when a `node` executable is resolvable on the current PATH. */
function nodeResolvesOnPath(): boolean {
    const names = process.platform === "win32" ? ["node.exe", "node.cmd", "node.bat"] : ["node"];
    for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
        if (!dir) continue;
        for (const name of names) {
            try {
                fs.accessSync(path.join(dir, name), fs.constants.X_OK);
                return true;
            } catch {
                // not here; keep looking
            }
        }
    }
    return false;
}

let nodePathEnsured = false;

/**
 * Idempotently make `node` resolvable for esbuild's child spawn (see module header).
 * Safe to call repeatedly; a no-op once done or when the host already has Node.
 */
export function ensureNodeOnPath(): void {
    if (nodePathEnsured) return;
    nodePathEnsured = true;

    const plan = planNodeShim({
        hasNode: nodeResolvesOnPath(),
        execPath: process.execPath,
        platform: process.platform,
    });

    if (plan.kind === "none") return;

    let dir: string;
    if (plan.kind === "prepend-dir") {
        dir = plan.dir;
    } else {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "bgforge-node-"));
        const shim = path.join(dir, plan.filename);
        fs.writeFileSync(shim, plan.contents);
        fs.chmodSync(shim, plan.mode);
    }
    process.env.PATH = dir + path.delimiter + (process.env.PATH ?? "");
}
