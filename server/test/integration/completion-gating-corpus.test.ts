/**
 * Corpus sweep for the per-position completion gates in D, Fallout SSL and TP2.
 *
 * These gates WITHHOLD completions, so the dangerous failure is the false positive - suppressing at a position
 * where the vocabulary is exactly what the user wants. A hand-written fixture cannot measure that; the rate
 * across real files is the oracle, and it must be zero. Behaviour classes per position are pinned by the unit
 * suites (`weidu-d/embedded-baf-provider`, `fallout-ssl/completion-gating`, `weidu-tp2/string-completion`);
 * this one measures them against argument and text shapes nobody wrote a fixture for.
 *
 * Two probe items stand in for the vocabulary: an action, which belongs at a code position and nowhere else,
 * and a variable, which TP2 alone keeps inside a string because `%var%` resolves there.
 *
 * Requires external repos (`pnpm test:integration`, which needs `pnpm test:external` first).
 */

import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import * as fg from "fast-glob";
import { CompletionItemKind, type CompletionItem, type Position } from "vscode-languageserver/node";
import type { Node as SyntaxNode } from "web-tree-sitter";
import * as dParser from "../../../shared/parsers/weidu-d";
import * as sslParser from "../../../shared/parsers/fallout-ssl";
import * as tp2Parser from "../../../shared/parsers/weidu-tp2";
import { weiduDProvider } from "../../src/weidu-d/provider";
import { falloutSslProvider } from "../../src/fallout-ssl/provider";
import { weiduTp2Provider } from "../../src/weidu-tp2/provider";
import { SyntaxType as DType } from "../../src/weidu-d/syntax-type";
import { SyntaxType as SslType } from "../../src/fallout-ssl/syntax-type";
import { SyntaxType as Tp2Type } from "../../src/weidu-tp2/syntax-type";
import { CompletionCategory, type Tp2CompletionItem } from "../../src/weidu-tp2/completion/types";
import { isAtDeclarationSite } from "../../src/weidu-tp2/completion/context";
import { normalizeUri, type NormalizedUri } from "../../src/core/normalized-uri";
import { FALLOUT_FIXTURES, IE_FIXTURES } from "./test-helpers";

const PROBE_ACTION = "PROBE_ACTION_ITEM";
const PROBE_VAR = "PROBE_VAR_ITEM";
const ITEMS: Tp2CompletionItem[] = [
    { label: PROBE_ACTION, kind: CompletionItemKind.Function, category: CompletionCategory.Action },
    { label: PROBE_VAR, kind: CompletionItemKind.Constant, category: CompletionCategory.Vars },
];

/**
 * How much of each corpus the sweep covers, and why it is not all of it. A probe costs one call into the
 * provider's real completion path, which for D is a few tree lookups but for SSL and TP2 re-extracts local
 * symbols and applies snippets - milliseconds each, against four figures of files. So D sweeps every file
 * while SSL and TP2 sample by stride (evenly spaced over the sorted list, deterministic, not the
 * alphabetically-first N). What is measured is a RATE, which a sample answers; the totals are asserted so a
 * cap that silently collected nothing cannot read as a pass.
 */
interface Coverage {
    /** Files to sample, evenly spaced; undefined sweeps every file. */
    readonly sampleFiles?: number;
    readonly probesPerFile: number;
    /** Floor on the probes each kind must collect, so a sweep that found nothing cannot read as a pass. */
    readonly minProbes: number;
}

function sample(files: readonly string[], coverage: Coverage): readonly string[] {
    const { sampleFiles } = coverage;
    if (sampleFiles === undefined || files.length <= sampleFiles) return files;
    const stride = files.length / sampleFiles;
    return Array.from({ length: sampleFiles }, (_, i) => files[Math.floor(i * stride)]!);
}

interface LanguageSweep {
    readonly name: string;
    readonly root: string;
    readonly glob: string;
    readonly parser: { initParser(): Promise<unknown>; parseWithCache(text: string): { rootNode: SyntaxNode } | null };
    readonly filter: (
        items: CompletionItem[],
        text: string,
        position: Position,
        uri: NormalizedUri,
    ) => CompletionItem[];
    readonly uri: NormalizedUri;
    /** Nodes whose start position is a structural keyword - always a code position. */
    readonly keywordNodes: ReadonlySet<string>;
    /** String literals, probed mid-body. */
    readonly stringNodes: ReadonlySet<string>;
    /**
     * Whether a variable stays on offer inside a string - true for TP2's `%var%` interpolation only. TP2
     * excepts a string that is a DECLARATION site (`OUTER_SPRINT "name" "value"`, `OUTER_SET
     * EVALUATE_BUFFER ~name%i%~`), where an older rule already answers with this file's locals alone; the
     * corpus holds 29 of those and they are not what this gate decides.
     */
    readonly keepsVarsInStrings: boolean;
    readonly coverage: Coverage;
}

const SWEEPS: readonly LanguageSweep[] = [
    {
        name: "weidu-d",
        root: IE_FIXTURES,
        glob: "**/*.d",
        parser: dParser,
        filter: (items, text, position, uri) => weiduDProvider.filterCompletions!(items, text, position, uri),
        uri: normalizeUri("file:///corpus.d"),
        keywordNodes: new Set([DType.State, DType.TransitionFull, DType.AddStateTrigger, DType.ReplaceSay]),
        stringNodes: new Set([DType.TildeString, DType.DoubleString]),
        keepsVarsInStrings: false,
        coverage: { probesPerFile: 25, minProbes: 5000 },
    },
    {
        name: "fallout-ssl",
        root: FALLOUT_FIXTURES,
        glob: "**/*.ssl",
        parser: sslParser,
        filter: (items, text, position, uri) => falloutSslProvider.filterCompletions!(items, text, position, uri),
        uri: normalizeUri("file:///corpus.ssl"),
        keywordNodes: new Set([SslType.Procedure, SslType.CallStmt, SslType.IfStmt, SslType.WhileStmt]),
        stringNodes: new Set([SslType.String]),
        keepsVarsInStrings: false,
        coverage: { sampleFiles: 200, probesPerFile: 4, minProbes: 300 },
    },
    {
        name: "weidu-tp2",
        root: IE_FIXTURES,
        glob: "**/*.{tp2,tpa,tph,tpp}",
        parser: tp2Parser,
        filter: (items, text, position, uri) => weiduTp2Provider.filterCompletions!(items, text, position, uri),
        uri: normalizeUri("file:///corpus.tp2"),
        keywordNodes: new Set([Tp2Type.Component, Tp2Type.ActionCopy]),
        stringNodes: new Set([Tp2Type.TildeString, Tp2Type.DoubleString, Tp2Type.FiveTildeString]),
        keepsVarsInStrings: true,
        coverage: { sampleFiles: 200, probesPerFile: 4, minProbes: 100 },
    },
];

interface Result {
    /** Keyword positions that kept the action - the correct outcome. */
    keywordOffered: number;
    /** Keyword positions that dropped it: the false positive this suite exists for. */
    keywordSuppressed: string[];
    /** String positions that dropped the action. */
    stringGated: number;
    /** String positions that kept it. */
    stringLeaked: string[];
    /** String positions that kept the variable - required for TP2, forbidden for the others. */
    stringKeptVar: number;
    /** String positions that dropped it, named so a failure says where. */
    stringDroppedVar: string[];
    /** String positions the variable claim was actually measured at (declaration sites excluded). */
    stringVarChecked: number;
}

function walk(root: SyntaxNode, visit: (node: SyntaxNode) => void): void {
    const stack: SyntaxNode[] = [root];
    for (let node = stack.pop(); node; node = stack.pop()) {
        visit(node);
        for (let i = node.childCount - 1; i >= 0; i--) {
            const child = node.child(i);
            if (child) stack.push(child);
        }
    }
}

function sweepFile(sweep: LanguageSweep, file: string, result: Result): void {
    const text = readFileSync(file, "utf-8");
    const tree = sweep.parser.parseWithCache(text);
    if (!tree) return;

    let keywords = 0;
    let strings = 0;
    walk(tree.rootNode, (node) => {
        const where = (position: Position): string =>
            `${file}:${position.line + 1}:${position.character + 1} ${node.type}`;
        if (keywords < sweep.coverage.probesPerFile && sweep.keywordNodes.has(node.type)) {
            keywords++;
            const position = { line: node.startPosition.row, character: node.startPosition.column };
            const labels = new Set(sweep.filter(ITEMS, text, position, sweep.uri).map((item) => item.label));
            if (labels.has(PROBE_ACTION)) result.keywordOffered++;
            else result.keywordSuppressed.push(where(position));
            return;
        }
        const singleLine = node.startPosition.row === node.endPosition.row;
        if (strings < sweep.coverage.probesPerFile && singleLine && sweep.stringNodes.has(node.type)) {
            strings++;
            // Mid-body, so the probe is unambiguously inside rather than on a delimiter boundary.
            const column = Math.floor((node.startPosition.column + node.endPosition.column) / 2);
            const position = { line: node.startPosition.row, character: column };
            const labels = new Set(sweep.filter(ITEMS, text, position, sweep.uri).map((item) => item.label));
            if (labels.has(PROBE_ACTION)) result.stringLeaked.push(where(position));
            else result.stringGated++;
            if (sweep.keepsVarsInStrings && isAtDeclarationSite(text, position) !== false) return;
            result.stringVarChecked++;
            if (labels.has(PROBE_VAR)) result.stringKeptVar++;
            else result.stringDroppedVar.push(where(position));
        }
    });
}

describe.each(SWEEPS)("$name completion gate against the real corpus", (sweep) => {
    const all = fg.sync(sweep.glob, { cwd: sweep.root, absolute: true, caseSensitiveMatch: false }).sort();
    const files = sample(all, sweep.coverage);
    const result: Result = {
        keywordOffered: 0,
        keywordSuppressed: [],
        stringGated: 0,
        stringLeaked: [],
        stringKeptVar: 0,
        stringDroppedVar: [],
        stringVarChecked: 0,
    };

    beforeAll(async () => {
        if (files.length === 0) return;
        await sweep.parser.initParser();
        for (const file of files) {
            sweepFile(sweep, file, result);
        }
        // Each probe re-enters the real completion path, so the sweep runs in tens of seconds, not the
        // default hook budget.
    }, 120000);

    it.skipIf(files.length === 0)("never suppresses the vocabulary at a structural keyword", () => {
        expect(result.keywordSuppressed).toEqual([]);
        // The floor guards against a sweep that silently collected nothing, not against corpus growth.
        expect(result.keywordOffered).toBeGreaterThan(sweep.coverage.minProbes);
    });

    it.skipIf(files.length === 0)("never offers the general vocabulary inside a string", () => {
        expect(result.stringLeaked).toEqual([]);
        expect(result.stringGated).toBeGreaterThan(sweep.coverage.minProbes);
    });

    it.skipIf(files.length === 0)("keeps variables inside a string only where they interpolate", () => {
        expect(result.stringKeptVar).toBe(sweep.keepsVarsInStrings ? result.stringVarChecked : 0);
        // Not vacuous: the declaration-site exception must not have swallowed the whole sample.
        expect(result.stringVarChecked).toBeGreaterThan(sweep.coverage.minProbes);
    });
});
