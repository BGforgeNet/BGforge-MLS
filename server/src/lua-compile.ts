/**
 * Lua compilation (syntax validation): spawn `luac -p`, parse output, send diagnostics.
 *
 * This validates Lua source syntax for both .lua and .menu files.
 * Embedded-only .menu validation is added in a later milestone.
 */

import * as cp from "child_process";
import * as crypto from "crypto";
import * as path from "path";
import {
    type ParseItemList,
    type ParseResult,
    addFallbackDiagnostic,
    conlog,
    getErrnoCode,
    reportCompileResult,
    sendParseResult,
    tmpDir,
    uriToPath,
} from "./common";
import { parseCommandPath, needsShell } from "./process-runner";
import { abortAllCompiles, compileWithTmpFile } from "./core/compile-with-tmp-file";
import { buildCompiledLuaText, extractLuaSegments, mapLuaLineToSource } from "./core/menu-embedded";
import { showError } from "./user-messages";
import type { LuaSettings } from "./settings";
import type { NormalizedUri } from "./core/normalized-uri";
import { EXT_LUA, EXT_MENU } from "./core/languages";

/** Track in-flight compilations per URI so we can cancel stale ones. */
const activeCompiles = new Map<NormalizedUri, AbortController>();

/** Abort every in-flight Lua compilation. Called from server shutdown. */
export function abortInFlightLuaCompiles(): void {
    abortAllCompiles(activeCompiles);
}

function parseLuacOutput(output: string, uri: NormalizedUri, lineMapper?: (luaLine: number) => number): ParseResult {
    const errors: ParseItemList = [];
    const warnings: ParseItemList = [];

    for (const rawLine of output.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (line.length === 0) {
            continue;
        }

        // luac format (cross-platform):
        //   luac: /path/file.lua:3: unexpected symbol near 'end'
        //   luac: C:\path\file.lua:3: <message>
        const normalized = line.replace(/^luac:\s*/, "");
        const match = /^(.*?):(\d+):\s*(.+)$/.exec(normalized);
        if (!match) {
            continue;
        }

        const filePath = match[1];
        const rawLineNum = match[2];
        const message = match[3];
        if (!filePath || !rawLineNum || !message) {
            continue;
        }
        const lineNum = parseInt(rawLineNum, 10);

        errors.push({
            uri,
            line: lineMapper ? lineMapper(lineNum) : lineNum,
            columnStart: 0,
            columnEnd: 1,
            message,
        });
    }

    return { errors, warnings };
}

function runLuacCheck(
    luacPath: string,
    args: readonly string[],
    cwd: string,
    signal?: AbortSignal,
    timeoutMs = 60000,
): Promise<{ err: cp.ExecFileException | null; stdout: string; stderr: string }> {
    const { executable, prefixArgs } = parseCommandPath(luacPath);
    const allArgs = [...prefixArgs, ...args];
    const shell = needsShell(executable);

    conlog(`${executable} ${allArgs.join(" ")}`);

    return new Promise((resolve) => {
        cp.execFile(
            executable,
            allArgs,
            { cwd, shell, signal, timeout: timeoutMs },
            (err, stdout: string, stderr: string) => {
                conlog("stdout: " + stdout);
                if (stderr) {
                    conlog("stderr: " + stderr);
                }
                if (err) {
                    conlog("error: " + err.message);
                }
                resolve({ err, stdout, stderr });
            },
        );
    });
}

export async function compile(uri: NormalizedUri, settings: LuaSettings, interactive = false, text: string) {
    const filePath = uriToPath(uri);
    const parsed = path.parse(filePath);
    const ext = parsed.ext.toLowerCase();
    const baseName = parsed.base;

    if (ext !== EXT_LUA && ext !== EXT_MENU) {
        return;
    }

    const segments =
        ext === EXT_MENU
            ? extractLuaSegments(text, uri)
            : [
                  {
                      lua: text,
                      kind: "statement" as const,
                      sourceLineStart: 1,
                      sourceLineEnd: text.split(/\r?\n/).length,
                      sourceUri: uri,
                  },
              ];

    if (segments.length === 0) {
        return;
    }

    const aggregateParseResult: ParseResult = { errors: [], warnings: [] };
    let compilerMissing = false;

    const compileSegment = async (segmentIndex: number): Promise<void> => {
        const segment = segments[segmentIndex];
        if (!segment) {
            return;
        }

        const segmentText = buildCompiledLuaText(segment);
        const uriHash = crypto.createHash("md5").update(`${uri}:${segmentIndex}`).digest("hex").slice(0, 8);
        const tmpPath = path.join(tmpDir, `tmp-lua-${uriHash}${EXT_LUA}`);

        await compileWithTmpFile({
            uri,
            tmpPath,
            text: segmentText.text,
            activeCompiles,
            run: async (signal) => {
                const { err, stdout, stderr } = await runLuacCheck(settings.path, ["-p", tmpPath], tmpDir, signal);
                if (signal.aborted) {
                    return;
                }

                const combinedOutput = [stdout, stderr].filter(Boolean).join("\n");
                let parseResult = parseLuacOutput(combinedOutput, uri, (luaLine: number) =>
                    mapLuaLineToSource(luaLine, segment),
                );

                if (err && parseResult.errors.length === 0) {
                    if (getErrnoCode(err) === "ENOENT") {
                        compilerMissing = true;
                    }
                    parseResult = addFallbackDiagnostic(parseResult, err, uri, combinedOutput);
                }

                aggregateParseResult.errors.push(...parseResult.errors);
                aggregateParseResult.warnings.push(...parseResult.warnings);
            },
        });
    };

    const runSegmentsSequentially = async (segmentIndex: number): Promise<void> => {
        if (segmentIndex >= segments.length) {
            return;
        }
        await compileSegment(segmentIndex);
        await runSegmentsSequentially(segmentIndex + 1);
    };

    await runSegmentsSequentially(0);

    if (compilerMissing && interactive) {
        showError(`Lua compiler not found at '${settings.path}'. Check bgforge.lua.path setting.`);
    }

    reportCompileResult(aggregateParseResult, interactive, `Compiled ${baseName}.`, `Failed to compile ${baseName}!`);
    sendParseResult(aggregateParseResult, uri, uri);
}
