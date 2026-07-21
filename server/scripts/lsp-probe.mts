/**
 * One-shot LSP fact-finding probe: spawn the BUILT server (server/out/server.js) over
 * --stdio, open one file, send one request, print the response. Exercises the same
 * path an editor does - no re-wiring of server internals, so it cannot drift from the
 * real request flow.
 *
 * Usage: pnpm lsp-probe <request> <file> [line] [col] [flags]
 *   request:  hover | completion | definition | references | symbols | signature | inlay | rename
 *   line/col: 1-based (editor-style); required for position requests, ignored for symbols/inlay
 *   flags:    --lang <id>        override the extension-derived languageId (e.g. weidu-ssl for .ssl)
 *             --workspace <dir>  workspace root sent at initialize (default: the file's directory)
 *             --new-name <name>  required for rename
 *             --json             full JSON output (completion is summarized to labels by default)
 *             --verbose          forward server window/logMessage notifications to stderr
 *
 * The workspace scan runs in the background after initialize, so cross-file results
 * (references, definition into another file) may be incomplete if probed instantly on a
 * huge workspace; point --workspace at a small directory when that matters.
 */

import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const LANG_BY_EXT: Record<string, string> = {
    ".ssl": "fallout-ssl",
    ".h": "fallout-ssl",
    ".msg": "fallout-msg",
    ".tp2": "weidu-tp2",
    ".tpa": "weidu-tp2",
    ".tph": "weidu-tp2",
    ".tpp": "weidu-tp2",
    ".baf": "weidu-baf",
    ".d": "weidu-d",
    ".slb": "weidu-slb",
    ".tra": "weidu-tra",
    ".2da": "infinity-2da",
    ".tssl": "typescript",
    ".tbaf": "typescript",
    ".td": "typescript",
};

const REQUESTS = ["hover", "completion", "definition", "references", "symbols", "signature", "inlay", "rename"];
const POSITIONLESS = new Set(["symbols", "inlay"]);

function usage(message?: string): never {
    if (message) console.error(`lsp-probe: ${message}`);
    console.error(
        "Usage: pnpm lsp-probe <request> <file> [line] [col] [--lang id] [--workspace dir] [--new-name n] [--json] [--verbose]",
    );
    console.error(`Requests: ${REQUESTS.join(", ")}. line/col are 1-based.`);
    process.exit(1);
}

interface Args {
    request: string;
    file: string;
    line: number;
    col: number;
    lang?: string;
    workspace?: string;
    newName?: string;
    json: boolean;
    verbose: boolean;
}

function parseArgs(argv: string[]): Args {
    const positional: string[] = [];
    const args: Args = { request: "", file: "", line: 0, col: 0, json: false, verbose: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === undefined) continue;
        if (a === "--json") args.json = true;
        else if (a === "--verbose") args.verbose = true;
        else if (a === "--lang") args.lang = argv[++i];
        else if (a === "--workspace") args.workspace = argv[++i];
        else if (a === "--new-name") args.newName = argv[++i];
        else if (a.startsWith("--")) usage(`unknown flag ${a}`);
        else positional.push(a);
    }
    const [requestName, file, line, col] = positional;
    if (!requestName || !REQUESTS.includes(requestName)) usage(`request must be one of: ${REQUESTS.join(", ")}`);
    if (!file) usage("missing file");
    args.request = requestName;
    args.file = resolve(file);
    if (!POSITIONLESS.has(requestName)) {
        if (!line || !col) usage(`${requestName} needs <line> <col> (1-based)`);
        args.line = Number(line);
        args.col = Number(col);
        if (!Number.isInteger(args.line) || !Number.isInteger(args.col) || args.line < 1 || args.col < 1) {
            usage("line and col must be positive integers");
        }
    }
    if (requestName === "rename" && !args.newName) usage("rename needs --new-name <name>");
    return args;
}

const args = parseArgs(process.argv.slice(2));

if (!existsSync(args.file)) usage(`file not found: ${args.file}`);
const serverPath = resolve(import.meta.dirname, "../out/server.js");
if (!existsSync(serverPath)) usage(`built server not found at ${serverPath} - run pnpm build (or build:dev) first`);

const text = readFileSync(args.file, "utf-8");
const uri = pathToFileURL(args.file).toString();
const languageId = args.lang ?? LANG_BY_EXT[extname(args.file)];
if (!languageId) usage(`no languageId known for ${extname(args.file)} - pass --lang <id>`);
const workspaceDir = resolve(args.workspace ?? dirname(args.file));
const position = { line: args.line - 1, character: args.col - 1 };

// Minimal JSON-RPC client over the server's stdio. Hand-rolled framing keeps the probe
// dependency-free; the payload shapes come straight from the LSP spec.
const child = spawn(process.execPath, [serverPath, "--stdio"], { stdio: ["pipe", "pipe", "pipe"], cwd: workspaceDir });

let nextId = 1;
const pending = new Map<number, (result: unknown, error?: unknown) => void>();

function send(message: Record<string, unknown>): void {
    const body = JSON.stringify({ jsonrpc: "2.0", ...message });
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function request(method: string, params: unknown): Promise<unknown> {
    const id = nextId++;
    send({ id, method, params });
    return new Promise((resolvePromise, rejectPromise) => {
        pending.set(id, (result, error) => {
            if (error) rejectPromise(new Error(`server error for ${method}: ${JSON.stringify(error)}`));
            else resolvePromise(result);
        });
    });
}

let buffer = Buffer.alloc(0);
child.stdout.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;
        const header = buffer.subarray(0, headerEnd).toString();
        const lengthMatch = /Content-Length: (\d+)/i.exec(header);
        if (!lengthMatch) throw new Error(`bad LSP header: ${header}`);
        const length = Number(lengthMatch[1]);
        const start = headerEnd + 4;
        if (buffer.length < start + length) return;
        const message = JSON.parse(buffer.subarray(start, start + length).toString());
        buffer = buffer.subarray(start + length);
        handleMessage(message);
    }
});

interface RpcMessage {
    id?: number;
    method?: string;
    params?: { type?: number; message?: string };
    result?: unknown;
    error?: unknown;
}

function handleMessage(message: RpcMessage): void {
    if (message.id !== undefined && message.method === undefined) {
        pending.get(message.id)?.(message.result, message.error);
        pending.delete(message.id);
    } else if (message.id !== undefined) {
        // Server-to-client request (e.g. capability registration): answer null so nothing hangs.
        send({ id: message.id, result: null });
    } else if (args.verbose && message.method === "window/logMessage") {
        console.error(`[server] ${message.params?.message}`);
    }
}

child.stderr.on("data", (chunk: Buffer) => {
    if (args.verbose) process.stderr.write(chunk);
});
child.on("exit", (code) => {
    if (!done) {
        console.error(`lsp-probe: server exited early (code ${code}); re-run with --verbose for server output`);
        process.exit(2);
    }
});

let done = false;
const timeout = setTimeout(() => {
    console.error("lsp-probe: timed out after 30s");
    child.kill("SIGKILL");
    process.exit(2);
}, 30_000);

function endOfDocument(): { line: number; character: number } {
    const lines = text.split("\n");
    return { line: lines.length - 1, character: (lines[lines.length - 1] ?? "").length };
}

const textDocument = { uri };
const REQUEST_SHAPES: Record<string, () => [string, unknown]> = {
    hover: () => ["textDocument/hover", { textDocument, position }],
    completion: () => ["textDocument/completion", { textDocument, position }],
    definition: () => ["textDocument/definition", { textDocument, position }],
    references: () => ["textDocument/references", { textDocument, position, context: { includeDeclaration: true } }],
    symbols: () => ["textDocument/documentSymbol", { textDocument }],
    signature: () => ["textDocument/signatureHelp", { textDocument, position }],
    inlay: () => [
        "textDocument/inlayHint",
        { textDocument, range: { start: { line: 0, character: 0 }, end: endOfDocument() } },
    ],
    rename: () => ["textDocument/rename", { textDocument, position, newName: args.newName }],
};

interface CompletionItemLike {
    label?: unknown;
    kind?: unknown;
}

function printResult(result: unknown): void {
    if (args.request === "completion" && !args.json && result !== null && typeof result === "object") {
        // Real completion lists run to thousands of items; summarize unless --json asked for all.
        const items = (Array.isArray(result) ? result : (result as { items?: CompletionItemLike[] }).items) ?? [];
        console.log(`${items.length} completion items; first ${Math.min(items.length, 50)}:`);
        for (const item of items.slice(0, 50)) console.log(`  ${item.label} (kind ${item.kind})`);
        if (items.length > 50) console.log("  ... (--json for the full list)");
        return;
    }
    console.log(JSON.stringify(result, null, 2));
}

await request("initialize", {
    processId: process.pid,
    rootUri: pathToFileURL(workspaceDir).toString(),
    workspaceFolders: [{ uri: pathToFileURL(workspaceDir).toString(), name: "probe" }],
    capabilities: {},
});
send({ method: "initialized", params: {} });
send({ method: "textDocument/didOpen", params: { textDocument: { uri, languageId, version: 1, text } } });

const shape = REQUEST_SHAPES[args.request];
if (!shape) usage(`request ${args.request} has no request shape`);
const [method, params] = shape();
const result = await request(method, params);
printResult(result);

done = true;
clearTimeout(timeout);
await request("shutdown", null);
send({ method: "exit", params: null });
setTimeout(() => child.kill("SIGKILL"), 1000).unref();
child.on("close", () => process.exit(0));
