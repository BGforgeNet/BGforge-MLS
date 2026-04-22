/**
 * Smoke test: verifies the LSP server starts over stdio, responds to
 * initialize, and shuts down cleanly. Requires a built server bundle
 * at server/out/server.js (run `pnpm build:base:server` first).
 */

import { mkdir, mkdtemp, rm, writeFile, access } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach } from "vitest";

const SERVER_PATH = join(__dirname, "..", "out", "server.js");

/** Encode a JSON-RPC message with Content-Length header. */
function encode(msg: object): string {
    const body = JSON.stringify(msg);
    return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
}

/** Read one JSON-RPC response from a buffer, returning [parsed, remaining]. */
function tryParse(buf: string): [unknown | null, string] {
    const headerEnd = buf.indexOf("\r\n\r\n");
    if (headerEnd === -1) return [null, buf];

    const header = buf.slice(0, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) return [null, buf];

    const len = parseInt(match[1]!, 10);
    const bodyStart = headerEnd + 4;
    if (buf.length < bodyStart + len) return [null, buf];

    const body = buf.slice(bodyStart, bodyStart + len);
    const rest = buf.slice(bodyStart + len);
    return [JSON.parse(body), rest];
}

/** Send a request and wait for a response with the matching id. */
function request(
    proc: ChildProcess,
    msg: { jsonrpc: string; id: number; method: string; params: unknown },
    timeoutMs = 30_000,
): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
        let buf = "";
        const timer = setTimeout(
            () => reject(new Error(`Timeout waiting for response to ${msg.method}`)),
            timeoutMs,
        );

        const onData = (chunk: Buffer) => {
            buf += chunk.toString();
            let parsed: unknown;
            [parsed, buf] = tryParse(buf);
            while (parsed !== null) {
                const obj = parsed as Record<string, unknown>;
                if (obj.id === msg.id) {
                    clearTimeout(timer);
                    proc.stdout!.off("data", onData);
                    resolve(obj);
                    return;
                }
                [parsed, buf] = tryParse(buf);
            }
        };

        proc.stdout!.on("data", onData);
        proc.stdin!.write(encode(msg));
    });
}

/** Send a notification (no response expected). */
function notify(
    proc: ChildProcess,
    msg: { jsonrpc: string; method: string; params?: unknown },
): void {
    proc.stdin!.write(encode(msg));
}

async function waitForFile(filePath: string, timeoutMs = 10_000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            await access(filePath);
            return;
        } catch {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }
    throw new Error(`Timed out waiting for file ${filePath}`);
}

describe("LSP stdio smoke test", () => {
    let proc: ChildProcess | undefined;
    let tempDir: string | undefined;

    afterEach(() => {
        if (proc && proc.exitCode === null) {
            proc.kill("SIGKILL");
        }
        if (tempDir) {
            void rm(tempDir, { recursive: true, force: true });
        }
        proc = undefined;
        tempDir = undefined;
    });

    it("initializes, responds with capabilities, and shuts down", { timeout: 30_000 }, async () => {
        proc = spawn("node", [SERVER_PATH, "--stdio"], {
            stdio: ["pipe", "pipe", "pipe"],
        });

        // Collect stderr for diagnostics on failure
        let stderr = "";
        proc.stderr!.on("data", (chunk: Buffer) => {
            stderr += chunk.toString();
        });

        // Send initialize
        const initResponse = await request(proc, {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
                processId: process.pid,
                capabilities: {},
                rootUri: null,
                workspaceFolders: null,
            },
        });

        expect(initResponse.result).toBeDefined();
        const result = initResponse.result as Record<string, unknown>;
        const capabilities = result.capabilities as Record<string, unknown>;

        // Verify key capabilities are present
        expect(capabilities.completionProvider).toBeDefined();
        expect(capabilities.hoverProvider).toBe(true);
        expect(capabilities.textDocumentSync).toBeDefined();

        // Send initialized notification
        notify(proc, { jsonrpc: "2.0", method: "initialized", params: {} });

        // Send shutdown request
        const shutdownResponse = await request(proc, {
            jsonrpc: "2.0",
            id: 2,
            method: "shutdown",
            params: null,
        });
        expect(shutdownResponse.result).toBe(null);

        // Send exit notification
        notify(proc, { jsonrpc: "2.0", method: "exit" });

        // Wait for clean exit
        const exitCode = await new Promise<number | null>((resolve) => {
            const timer = setTimeout(() => {
                proc!.kill("SIGKILL");
                resolve(null);
            }, 5000);
            proc!.on("exit", (code) => {
                clearTimeout(timer);
                resolve(code);
            });
        });

        expect(exitCode, `Server exited uncleanly. stderr:\n${stderr}`).toBe(0);
    });

    it("does not write raw compile logs to stdout during stdio save-triggered TD compile", { timeout: 30_000 }, async () => {
        tempDir = await mkdtemp(join(tmpdir(), "bgforge-mls-stdio-"));
        const sourcePath = join(tempDir, "dialog.td");
        const outputPath = join(tempDir, "dialog.d");
        const sourceUri = `file://${sourcePath}`;
        const sourceText = `
function start() {
    say(tra(100));
    exit();
}
begin("DIALOG", [start]);
`.trimStart();

        await mkdir(tempDir, { recursive: true });
        await writeFile(sourcePath, sourceText, "utf8");

        proc = spawn("node", [SERVER_PATH, "--stdio"], {
            stdio: ["pipe", "pipe", "pipe"],
        });

        let stderr = "";
        let stdout = "";
        proc.stderr!.on("data", (chunk: Buffer) => {
            stderr += chunk.toString();
        });
        proc.stdout!.on("data", (chunk: Buffer) => {
            stdout += chunk.toString();
        });

        const initResponse = await request(proc, {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
                processId: process.pid,
                capabilities: {},
                rootUri: null,
                workspaceFolders: null,
            },
        });
        expect(initResponse.result).toBeDefined();

        notify(proc, { jsonrpc: "2.0", method: "initialized", params: {} });
        notify(proc, {
            jsonrpc: "2.0",
            method: "textDocument/didOpen",
            params: {
                textDocument: {
                    uri: sourceUri,
                    languageId: "typescript",
                    version: 1,
                    text: sourceText,
                },
            },
        });
        notify(proc, {
            jsonrpc: "2.0",
            method: "textDocument/didSave",
            params: {
                textDocument: { uri: sourceUri },
                text: sourceText,
            },
        });

        await waitForFile(outputPath);
        await new Promise(resolve => setTimeout(resolve, 200));

        expect(stdout, `Unexpected raw stdout during stdio compile. stderr:\n${stderr}`).not.toContain(
            `Transpiled to ${outputPath}`,
        );
    });
});
