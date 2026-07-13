/**
 * Force esbuild-wasm's child spawn to use the extension host's own Node runtime.
 *
 * esbuild-wasm's Node build can't run the WASM in-process, so it spawns `node <bin/esbuild>` via a
 * bare PATH lookup. That trusts whatever "node" PATH resolves to - which may be absent (an editor
 * ships its own runtime) or a broken shim (stale nvm/mise), and either way the child dies and
 * permanently kills esbuild's initialize-once service. We point "node" at process.execPath before
 * esbuild spawns - unconditionally, since a present-but-broken shim defeats an "only when missing"
 * guard. Mirrors child_process.fork's default and is the home of that invariant; sslc relies on
 * fork directly (server/src/sslc/ssl_compiler.ts).
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/** A `node` shim to write into an isolated dir that is then prepended to PATH. Pure, so testable. */
export interface NodeShim {
    readonly filename: string;
    readonly contents: string;
    readonly mode: number;
}

/**
 * Build a `node` shim that re-execs process.execPath. `ELECTRON_RUN_AS_NODE=1` makes an Electron
 * editor binary behave as Node; a real `node` execPath ignores it, so one shape serves both.
 */
export function planNodeShim(input: { readonly execPath: string; readonly platform: NodeJS.Platform }): NodeShim {
    if (input.platform === "win32") {
        return {
            filename: "node.cmd",
            contents: `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${input.execPath}" %*\r\n`,
            mode: 0o755,
        };
    }
    return {
        filename: "node",
        contents: `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${input.execPath}" "$@"\n`,
        mode: 0o755,
    };
}

let nodePathEnsured = false;

/**
 * Idempotently prepend an isolated `node` -> process.execPath shim to PATH so esbuild's child uses
 * our runtime, never PATH's `node`. Isolated dir so it shadows only `node`. No-op after the first call.
 */
export function ensureNodeOnPath(): void {
    if (nodePathEnsured) return;
    nodePathEnsured = true;

    const shim = planNodeShim({ execPath: process.execPath, platform: process.platform });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bgforge-node-"));
    const shimPath = path.join(dir, shim.filename);
    fs.writeFileSync(shimPath, shim.contents);
    fs.chmodSync(shimPath, shim.mode);
    process.env.PATH = dir + path.delimiter + (process.env.PATH ?? "");
}
