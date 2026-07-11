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
import { LSP_COMMAND_PARSE_DIALOG } from "../../shared/protocol";

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
    timeoutMs = 30000,
): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
        let buf = "";
        const timer = setTimeout(() => reject(new Error(`Timeout waiting for response to ${msg.method}`)), timeoutMs);

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
function notify(proc: ChildProcess, msg: { jsonrpc: string; method: string; params?: unknown }): void {
    proc.stdin!.write(encode(msg));
}

async function waitForFile(filePath: string, timeoutMs = 10000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            // Polling loop - the await is the polling mechanism itself.
            // eslint-disable-next-line no-await-in-loop
            await access(filePath);
            return;
        } catch {
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => {
                setTimeout(resolve, 50);
            });
        }
    }
    throw new Error(`Timed out waiting for file ${filePath}`);
}

/** Spawn the built server and complete the initialize/initialized handshake. Returns the process. */
async function spawnInitialized(): Promise<ChildProcess> {
    const proc = spawn("node", [SERVER_PATH, "--stdio"], {
        stdio: ["pipe", "pipe", "pipe"],
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
    if (!initResponse.result) {
        throw new Error("initialize returned no result");
    }
    notify(proc, { jsonrpc: "2.0", method: "initialized", params: {} });
    return proc;
}

/**
 * Attach a persistent collector for every parsed JSON-RPC message (response or
 * notification) the server writes to stdout, for the lifetime of the process.
 * Independent of request()'s own per-call listener - each keeps its own buffer.
 */
function collectMessages(proc: ChildProcess): Record<string, unknown>[] {
    const messages: Record<string, unknown>[] = [];
    let buf = "";
    proc.stdout!.on("data", (chunk: Buffer) => {
        buf += chunk.toString();
        let parsed: unknown;
        [parsed, buf] = tryParse(buf);
        while (parsed !== null) {
            messages.push(parsed as Record<string, unknown>);
            [parsed, buf] = tryParse(buf);
        }
    });
    return messages;
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

    it("initializes, responds with capabilities, and shuts down", { timeout: 30000 }, async () => {
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

    it(
        "does not write raw compile logs to stdout during stdio save-triggered TD compile",
        { timeout: 30000 },
        async () => {
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
            // Poll until stdout has been stable (no new bytes) for 100 ms, up to 2 s.
            // This ensures any trailing log lines emitted after the output file appears are captured
            // before the negative assertion, without relying on a fixed-duration sleep.
            await (async () => {
                const stableMs = 100;
                const timeoutMs = 2000;
                const start = Date.now();
                let lastLen = stdout.length;
                let stableStart = Date.now();
                while (Date.now() - start < timeoutMs) {
                    // eslint-disable-next-line no-await-in-loop
                    await new Promise((r) => {
                        setTimeout(r, 20);
                    });
                    if (stdout.length !== lastLen) {
                        lastLen = stdout.length;
                        stableStart = Date.now();
                    } else if (Date.now() - stableStart >= stableMs) {
                        break;
                    }
                }
            })();

            expect(stdout, `Unexpected raw stdout during stdio compile. stderr:\n${stderr}`).not.toContain(
                `Transpiled to ${outputPath}`,
            );
        },
    );

    // The tests below each drive one previously-untested provider/handler through the real
    // built server, black-box, as a smoke-level substitute for direct unit-test imports (see
    // server/vitest.config.ts "Coverage scope" for the exclusion-vs-smoke-test policy).

    it("fallout-worldmap: hover resolves a static terrain keyword", { timeout: 30000 }, async () => {
        proc = await spawnInitialized();

        const uri = "file:///worldmap-smoke.txt";
        const text = "Forced=100%\n";
        notify(proc, {
            jsonrpc: "2.0",
            method: "textDocument/didOpen",
            params: {
                textDocument: { uri, languageId: "fallout-worldmap-txt", version: 1, text },
            },
        });

        const hoverResponse = await request(proc, {
            jsonrpc: "2.0",
            id: 2,
            method: "textDocument/hover",
            params: { textDocument: { uri }, position: { line: 0, character: 2 } },
        });

        // "Forced" (server/data/fallout-worldmap-txt.yml, terrain category) has no YAML `doc`,
        // so static-loader.ts falls back to a minimal hover using the label itself.
        expect(hoverResponse.result).toEqual({ contents: { kind: "markdown", value: "Forced" } });
    });

    it("weidu-baf: hover resolves a static action keyword", { timeout: 30000 }, async () => {
        proc = await spawnInitialized();

        const uri = "file:///baf-smoke.baf";
        const text = [
            "IF",
            '  Global("var", "LOCALS", 0)',
            "THEN",
            "  RESPONSE #100",
            "    ActionOverride(Myself,DisplayString(Myself,12345))",
            "END",
        ]
            .join("\n")
            .concat("\n");
        notify(proc, {
            jsonrpc: "2.0",
            method: "textDocument/didOpen",
            params: {
                textDocument: { uri, languageId: "weidu-baf", version: 1, text },
            },
        });

        const hoverResponse = await request(proc, {
            jsonrpc: "2.0",
            id: 2,
            method: "textDocument/hover",
            params: { textDocument: { uri }, position: { line: 4, character: 6 } },
        });

        const result = hoverResponse.result as { contents: { value: string } } | null;
        expect(result?.contents.value).toContain("ActionOverride(O:Actor, A:Action)");
    });

    it("weidu-d: documentSymbol extracts state labels", { timeout: 30000 }, async () => {
        proc = await spawnInitialized();

        const uri = "file:///d-smoke.d";
        const text = [
            "BEGIN ~DIALOG~",
            "",
            "IF ~True()~ THEN BEGIN start_state",
            "    SAY ~Hello!~",
            "END",
            "",
            "IF ~~ THEN BEGIN end_state",
            "    SAY ~Goodbye!~",
            "END",
            "",
        ].join("\n");
        notify(proc, {
            jsonrpc: "2.0",
            method: "textDocument/didOpen",
            params: {
                textDocument: { uri, languageId: "weidu-d", version: 1, text },
            },
        });

        const symbolResponse = await request(proc, {
            jsonrpc: "2.0",
            id: 2,
            method: "textDocument/documentSymbol",
            params: { textDocument: { uri } },
        });

        const symbols = symbolResponse.result as Array<{ name: string }>;
        expect(symbols.map((s) => s.name)).toEqual(["start_state", "end_state"]);
    });

    it("infinity-2da: formatting column-aligns a table", { timeout: 30000 }, async () => {
        proc = await spawnInitialized();

        const uri = "file:///smoke.2da";
        const text = ["2DA V1.0", "****", "   ResRef  Type", "Charm_Person SPWI104 3", "Friends SPWI107 3"]
            .join("\n")
            .concat("\n");
        notify(proc, {
            jsonrpc: "2.0",
            method: "textDocument/didOpen",
            params: {
                textDocument: { uri, languageId: "infinity-2da", version: 1, text },
            },
        });

        const formatResponse = await request(proc, {
            jsonrpc: "2.0",
            id: 2,
            method: "textDocument/formatting",
            params: { textDocument: { uri }, options: { tabSize: 4, insertSpaces: true } },
        });

        const edits = formatResponse.result as Array<{ newText: string }>;
        expect(edits).toHaveLength(1);
        const outLines = edits[0]!.newText.split("\n");
        // "ResRef" in the header must align to the same column as "SPWI104" in the first data row
        // (mirrors format/test/infinity-2da.test.ts "aligns column names and data under the same
        // column positions").
        expect(outLines[2]!.indexOf("ResRef")).toBe(outLines[3]!.indexOf("SPWI104"));
    });

    it("fallout-scripts-lst (format-only provider): formatting normalizes to CRLF", { timeout: 30000 }, async () => {
        proc = await spawnInitialized();

        const uri = "file:///scripts.lst";
        const text = "AR0100.int\n";
        notify(proc, {
            jsonrpc: "2.0",
            method: "textDocument/didOpen",
            params: {
                textDocument: { uri, languageId: "fallout-scripts-lst", version: 1, text },
            },
        });

        const formatResponse = await request(proc, {
            jsonrpc: "2.0",
            id: 2,
            method: "textDocument/formatting",
            params: { textDocument: { uri }, options: { tabSize: 4, insertSpaces: true } },
        });

        const edits = formatResponse.result as Array<{ newText: string }>;
        expect(edits).toHaveLength(1);
        expect(edits[0]!.newText).toBe("AR0100.int\r\n");
    });

    it("weidu-log: definition resolves a mod path to its .tp2 file", { timeout: 30000 }, async () => {
        tempDir = await mkdtemp(join(tmpdir(), "bgforge-mls-weidu-log-"));
        const modDir = join(tempDir, "ALTERNATIVES");
        const tp2Path = join(modDir, "SETUP-ALTERNATIVES.TP2");
        const logPath = join(tempDir, "weidu.log");
        await mkdir(modDir, { recursive: true });
        await writeFile(tp2Path, "// mod installer\n", "utf8");
        const logText = "~ALTERNATIVES/SETUP-ALTERNATIVES.TP2~ #0 #0 // Alternatives: v1\n";
        await writeFile(logPath, logText, "utf8");
        const logUri = `file://${logPath}`;

        proc = await spawnInitialized();

        notify(proc, {
            jsonrpc: "2.0",
            method: "textDocument/didOpen",
            params: {
                textDocument: { uri: logUri, languageId: "weidu-log", version: 1, text: logText },
            },
        });

        const definitionResponse = await request(proc, {
            jsonrpc: "2.0",
            id: 2,
            method: "textDocument/definition",
            params: { textDocument: { uri: logUri }, position: { line: 0, character: 10 } },
        });

        const location = definitionResponse.result as { uri: string } | null;
        expect(location?.uri).toBe(`file://${tp2Path}`);
    });

    it("execute-command: bgforge.parseDialog returns states for a WeiDU D dialog", { timeout: 30000 }, async () => {
        proc = await spawnInitialized();

        const uri = "file:///parse-dialog-smoke.d";
        const text = [
            "BEGIN ~DIALOG~",
            "",
            "IF ~True()~ THEN BEGIN start_state",
            "    SAY ~Hello!~",
            "END",
            "",
            "IF ~~ THEN BEGIN end_state",
            "    SAY ~Goodbye!~",
            "END",
            "",
        ].join("\n");
        notify(proc, {
            jsonrpc: "2.0",
            method: "textDocument/didOpen",
            params: {
                textDocument: { uri, languageId: "weidu-d", version: 1, text },
            },
        });

        const commandResponse = await request(proc, {
            jsonrpc: "2.0",
            id: 2,
            method: "workspace/executeCommand",
            params: { command: LSP_COMMAND_PARSE_DIALOG, arguments: [{ uri }] },
        });

        const result = commandResponse.result as { states: Array<{ label: string }>; messages: unknown };
        expect(result.states.map((s) => s.label)).toEqual(["start_state", "end_state"]);
        expect(result.messages).toEqual({});
    });

    it(
        "config: onDidChangeConfiguration applies bgforge.debug so hover logs the resolved symbol",
        { timeout: 30000 },
        async () => {
            proc = await spawnInitialized();
            const messages = collectMessages(proc);

            // capabilities.configuration is false (our initialize params advertise no
            // workspace.configuration support), so handlers/config.ts's onDidChangeConfiguration
            // takes the change.settings.bgforge branch directly - no workspace/configuration
            // round-trip needed.
            notify(proc, {
                jsonrpc: "2.0",
                method: "workspace/didChangeConfiguration",
                params: { settings: { bgforge: { debug: true } } },
            });

            const uri = "file:///config-smoke.txt";
            const text = "Forced=100%\n";
            notify(proc, {
                jsonrpc: "2.0",
                method: "textDocument/didOpen",
                params: {
                    textDocument: { uri, languageId: "fallout-worldmap-txt", version: 1, text },
                },
            });

            const hoverResponse = await request(proc, {
                jsonrpc: "2.0",
                id: 2,
                method: "textDocument/hover",
                params: { textDocument: { uri }, position: { line: 0, character: 2 } },
            });
            expect(hoverResponse.result).toEqual({ contents: { kind: "markdown", value: "Forced" } });

            // hover.ts only emits this line when serverCtx.settings.debug is true - proves the
            // didChangeConfiguration notification actually reached registry/server-context state.
            const debugLog = messages.find((m) => {
                if (m.method !== "window/logMessage") return false;
                const params = m.params as { message?: unknown } | undefined;
                return typeof params?.message === "string" && params.message.includes('[hover] symbol="Forced"');
            });
            expect(
                debugLog,
                `Expected a debug hover log after enabling bgforge.debug via didChangeConfiguration. ` +
                    `logMessage notifications seen: ${JSON.stringify(messages.filter((m) => m.method === "window/logMessage"))}`,
            ).toBeDefined();
        },
    );
});
