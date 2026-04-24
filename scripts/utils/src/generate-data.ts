/**
 * Generates LSP completion, hover, and signature JSON files from YAML data.
 * Replaces the former generate_data.py script.
 *
 * Usage:
 *   pnpm exec tsx scripts/utils/src/generate-data.ts \
 *     -i file1.yml file2.yml \
 *     --completion out/completion.json \
 *     --hover out/hover.json \
 *     --signature out/signature.json \
 *     --tooltip-lang fallout-ssl-tooltip
 */

import fs from "node:fs";
import { parseArgs } from "node:util";
import YAML from "yaml";
import { formatSignature } from "../../../shared/signature-format.ts";
import { buildSignatureBlock, buildWeiduHoverContent, formatDeprecation } from "../../../shared/tooltip-format.ts";
import { buildFalloutArgsTable, buildWeiduTable, type VarRow, type VarSection } from "../../../shared/tooltip-table.ts";
import { WEIDU_TP2_CALLABLE_PREFIX } from "../../../shared/stanza-names.ts";
import { WEIDU_JSDOC_TYPES } from "../../../shared/weidu-types.ts";
import { cmpStr } from "./yaml-helpers.ts";

// -- Types --

interface DataArg {
    readonly name: string;
    readonly type: string;
    readonly doc?: string;
    readonly required?: boolean;
    readonly default?: string;
}

interface DataItem {
    readonly name: string;
    readonly detail?: string;
    readonly doc?: string;
    readonly args?: readonly DataArg[];
    readonly rets?: readonly DataArg[];
    readonly type?: string;
    readonly deprecated?: boolean | string;
}

interface DataStanza {
    readonly type: number;
    readonly items: readonly DataItem[];
    /** Optional category override. When set, items use this instead of the stanza key for completion filtering. */
    readonly category?: string;
}

export type DataFile = Record<string, DataStanza>;

interface MarkupContent {
    readonly kind: "markdown";
    readonly value: string;
}

/** Serialized parameter data for a single variable. Shape matches CallableParam in symbol.ts. */
interface CompletionParam {
    readonly name: string;
    readonly type?: string;
    readonly defaultValue?: string;
    readonly description?: string;
    readonly required?: boolean;
}

/** Serialized parameter categories for WeiDU callables. */
interface CompletionParams {
    readonly intVar: readonly CompletionParam[];
    readonly strVar: readonly CompletionParam[];
    readonly ret: readonly string[];
    readonly retArray: readonly string[];
}

interface CompletionResult {
    readonly label: string;
    readonly kind: number;
    readonly source: "builtin";
    readonly category: string;
    readonly documentation?: MarkupContent;
    readonly tags?: readonly number[];
    readonly detail?: string;
    /** Parameter data for WeiDU callables; enables param name completion at runtime. */
    readonly params?: CompletionParams;
}

interface HoverResult {
    readonly contents: MarkupContent;
}

interface SignatureParam {
    readonly label: string;
    readonly documentation: MarkupContent;
}

interface SignatureResult {
    readonly label: string;
    readonly documentation: MarkupContent;
    readonly parameters: readonly SignatureParam[];
}

// -- Core logic (exported for testing) --

/** Known WeiDU item.type values that map to "X function NAME" detail strings. */
const WEIDU_ITEM_TYPES = new Set(["patch", "action", "dimorphic"]);

/**
 * Maps callable stanza names to their hover signature prefix.
 * Used to inject "action function", "patch macro", etc. into hover tooltips
 * at build time. Only applies when item has no structured args/rets
 * (items with args already get the prefix via getDetail's WeiDU path).
 */
const STANZA_CALLABLE_PREFIX = WEIDU_TP2_CALLABLE_PREFIX;

/**
 * Returns true if the item uses WeiDU-style structured format.
 * Detection: item.type is a known WeiDU callable type (patch/action/dimorphic)
 * or item has rets. Arg types alone are ambiguous ("int" appears in both Fallout and WeiDU).
 */
function isWeiduFormat(item: DataItem): boolean {
    if (item.type !== undefined && WEIDU_ITEM_TYPES.has(item.type)) {
        return true;
    }
    return item.rets !== undefined;
}

const COMPLETION_TAG_DEPRECATED = 1;

/**
 * Validates that parsed YAML data conforms to the DataFile structure.
 * Checks that each stanza has a numeric type and an items array.
 */
function validateDataFile(data: unknown, source: string): DataFile {
    if (typeof data !== "object" || data === null) {
        throw new Error(`Expected object in ${source}, got ${data === null ? "null" : typeof data}`);
    }
    const record = data as Record<string, unknown>;
    const result: Record<string, DataStanza> = {};
    for (const [key, value] of Object.entries(record)) {
        if (typeof value !== "object" || value === null) {
            throw new Error(`Expected object for stanza '${key}' in ${source}`);
        }
        const stanza = value as Record<string, unknown>;
        if (typeof stanza["type"] !== "number") {
            throw new TypeError(`Expected numeric 'type' in stanza '${key}' of ${source}`);
        }
        if (!Array.isArray(stanza["items"])) {
            throw new TypeError(`Expected 'items' array in stanza '${key}' of ${source}`);
        }
        result[key] = stanza as unknown as DataStanza;
    }
    return result;
}

function sortDataItems(items: readonly DataItem[]): readonly DataItem[] {
    return [...items].sort((a, b) => {
        const byName = cmpStr(a.name, b.name);
        if (byName !== 0) {
            return byName;
        }
        return cmpStr(a.detail ?? "", b.detail ?? "");
    });
}

function sortDataFile(data: DataFile): DataFile {
    const result: Record<string, DataStanza> = {};
    for (const stanzaName of Object.keys(data).sort(cmpStr)) {
        const stanza = data[stanzaName]!;
        result[stanzaName] = {
            ...stanza,
            items: sortDataItems(stanza.items),
        };
    }
    return result;
}

/**
 * Loads and merges multiple YAML data files.
 * Later files override earlier ones (last-writer-wins per stanza key).
 */
export function loadData(yamlPaths: readonly string[]): DataFile {
    let result: DataFile = {};
    for (const ypath of yamlPaths) {
        const content = fs.readFileSync(ypath, "utf8");
        const ydata = validateDataFile(YAML.parse(content) as unknown, ypath);
        result = { ...result, ...ydata };
    }
    return sortDataFile(result);
}

/**
 * Returns full function invocation string.
 * Fallout format: "int get_sfall_arg_at(int a, ObjectPtr b)"
 * WeiDU format: "dimorphic function SUBSTRING" (no args in signature)
 * When includeTypes is false, omits types (used for signature labels).
 *
 * @param stanzaName Optional stanza key (e.g., "action_functions"). When provided,
 *   items without structured args/rets get the callable prefix from STANZA_CALLABLE_PREFIX.
 */
export function getDetail(item: DataItem, includeTypes = true, stanzaName?: string): string {
    if (item.args !== undefined || item.rets !== undefined) {
        // WeiDU format: show "type function NAME" without parenthesized args
        if (isWeiduFormat(item)) {
            if (includeTypes && item.type !== undefined && WEIDU_ITEM_TYPES.has(item.type)) {
                return `${item.type} function ${item.name}`;
            }
            return item.name;
        }

        // Fallout format: show "returnType name(type arg, ...)"
        if (item.args !== undefined) {
            const params = item.args.map((a) => ({
                name: a.name,
                type: includeTypes ? a.type : undefined,
            }));
            return formatSignature({
                name: item.name,
                prefix: includeTypes && item.type ? `${item.type} ` : "",
                params,
            });
        }
    }

    const base = item.detail ?? item.name;

    // For callable stanzas, prepend context+dtype prefix if not already present
    if (includeTypes && stanzaName) {
        const prefix = STANZA_CALLABLE_PREFIX[stanzaName];
        if (prefix && !base.startsWith(prefix)) {
            return `${prefix}${base}`;
        }
    }

    return base;
}

/** Fallout-style doc: 2-column table of args with descriptions + prose description. */
function getFalloutDoc(item: DataItem): string {
    let doc = "";
    if (item.args !== undefined) {
        const table = buildFalloutArgsTable(item.args.map((a) => ({ name: a.name, description: a.doc })));
        if (table) {
            doc += table + "\n";
        }
    }
    if (item.args !== undefined && item.doc !== undefined) {
        doc += "\n";
    }
    if (item.doc !== undefined) {
        doc += item.doc;
    }
    return doc;
}

/**
 * Build serialized parameter data for a WeiDU callable.
 * Returns undefined when the item has no args or rets (no params to complete).
 */
function buildCompletionParams(item: DataItem): CompletionParams | undefined {
    const hasArgs = item.args !== undefined && item.args.length > 0;
    const hasRets = item.rets !== undefined && item.rets.length > 0;
    if (!hasArgs && !hasRets) {
        return undefined;
    }

    const intVar: CompletionParam[] = [];
    const strVar: CompletionParam[] = [];
    for (const arg of item.args ?? []) {
        const category = WEIDU_JSDOC_TYPES.get(arg.type)?.category;
        const param: CompletionParam = {
            name: arg.name,
            type: arg.type,
            ...(arg.doc ? { description: arg.doc } : {}),
            ...(arg.required ? { required: true } : arg.default !== undefined ? { defaultValue: arg.default } : {}),
        };
        if (category === "int") {
            intVar.push(param);
        } else {
            // Unknown types (not in WEIDU_JSDOC_TYPES) default to strVar as a conservative fallback.
            strVar.push(param);
        }
    }

    const ret = (item.rets ?? []).map((r) => r.name);

    // retArray is not representable in the YAML data format; always empty for built-ins.
    // User-defined functions (from .tph headers) populate retArray via header-parser.ts.
    return { intVar, strVar, ret, retArray: [] };
}

/** Map DataArg[] to VarRow[] for a given INT/STR category. */
function mapArgsToRows(args: readonly DataArg[], category: "int" | "str"): readonly VarRow[] {
    return args
        .filter((a) => WEIDU_JSDOC_TYPES.get(a.type)?.category === category)
        .map((a) => ({
            type: a.type,
            name: a.name,
            ...(a.required ? { required: true } : a.default !== undefined ? { default: a.default } : {}),
            ...(a.doc ? { description: a.doc } : {}),
        }));
}

/** Build the WeiDU param table string from a data item's args and rets. */
function getWeiduParamTable(item: DataItem): string {
    const sections: VarSection[] = [];

    if (item.args !== undefined && item.args.length > 0) {
        sections.push({ label: "INT vars", rows: mapArgsToRows(item.args, "int") });
        sections.push({ label: "STR vars", rows: mapArgsToRows(item.args, "str") });
    }

    if (item.rets !== undefined && item.rets.length > 0) {
        sections.push({
            label: "RET vars",
            rows: item.rets.map((r) => ({
                type: r.type,
                name: r.name,
                ...(r.doc ? { description: r.doc } : {}),
            })),
        });
    }

    return buildWeiduTable(sections);
}

function markdown(value: string): MarkupContent {
    return { kind: "markdown", value };
}

/**
 * Generates completion items from data stanzas.
 */
export function generateCompletion(data: DataFile, tooltipLangId: string): readonly CompletionResult[] {
    const sortedData = sortDataFile(data);
    // Count label occurrences across all stanzas
    const labelCounts = new Map<string, number>();
    for (const stanza of Object.values(sortedData)) {
        for (const item of stanza.items) {
            labelCounts.set(item.name, (labelCounts.get(item.name) ?? 0) + 1);
        }
    }

    const result: CompletionResult[] = [];
    for (const [stanzaName, stanza] of Object.entries(sortedData)) {
        const kind = stanza.type;
        for (const item of stanza.items) {
            const label = item.name;
            const detail = getDetail(item, true, stanzaName);

            let documentation: MarkupContent | undefined;
            if (isWeiduFormat(item)) {
                const paramTable = getWeiduParamTable(item);
                documentation = markdown(
                    buildWeiduHoverContent({
                        signature: detail,
                        langId: tooltipLangId,
                        description: item.doc,
                        paramTable: paramTable || undefined,
                        deprecated: item.deprecated,
                    }),
                );
            } else {
                const doc = getFalloutDoc(item);
                if (detail !== label || doc !== "") {
                    let mdValue = buildSignatureBlock(detail, tooltipLangId);
                    if (doc !== "") {
                        mdValue += `\n${doc}`;
                    }
                    mdValue += formatDeprecation(item.deprecated);
                    documentation = markdown(mdValue);
                }
            }

            const deprecated = item.deprecated ?? false;
            const tags = deprecated ? ([COMPLETION_TAG_DEPRECATED] as const) : undefined;
            const params = isWeiduFormat(item) ? buildCompletionParams(item) : undefined;

            const completionItem: CompletionResult = {
                label,
                kind,
                source: "builtin",
                category: stanza.category ?? stanzaName,
                ...(documentation !== undefined ? { documentation } : {}),
                ...(tags !== undefined ? { tags } : {}),
                // Copy detail only for duplicate labels across stanzas.
                // Non-null assertion is safe: label comes from the same data that built labelCounts.
                ...(labelCounts.get(label)! > 1 ? { detail } : {}),
                ...(params !== undefined ? { params } : {}),
            };

            result.push(completionItem);
        }
    }
    return result;
}

/**
 * Generates hover data keyed by symbol name.
 */
export function generateHover(data: DataFile, langId: string): Record<string, HoverResult> {
    const sortedData = sortDataFile(data);
    const result: Record<string, HoverResult> = {};
    for (const [stanzaName, stanza] of Object.entries(sortedData)) {
        for (const item of stanza.items) {
            // Skip items with no data besides the name
            if (
                item.detail === undefined &&
                item.doc === undefined &&
                item.args === undefined &&
                item.rets === undefined
            ) {
                continue;
            }

            const label = item.name;
            const detail = getDetail(item, true, stanzaName);

            let value: string;
            if (isWeiduFormat(item)) {
                const paramTable = getWeiduParamTable(item);
                value = buildWeiduHoverContent({
                    signature: detail,
                    langId,
                    description: item.doc,
                    paramTable: paramTable || undefined,
                    deprecated: item.deprecated,
                });
            } else {
                value = buildSignatureBlock(detail, langId);
                const doc = getFalloutDoc(item);
                if (doc !== "") {
                    value += `\n${doc}`;
                }
                value += formatDeprecation(item.deprecated);
            }

            if (result[label]) {
                // Skip if identical content already present
                if (result[label]!.contents.value === value) {
                    continue;
                }
                // Merge overloads: append with separator
                result[label] = {
                    contents: markdown(result[label]!.contents.value + "\n\n---\n\n" + value),
                };
            } else {
                result[label] = { contents: markdown(value) };
            }
        }
    }
    return result;
}

/**
 * Generates signature help data for items with args.
 * WeiDU items include INT_VAR/STR_VAR category prefix in parameter docs.
 */
export function generateSignatures(data: DataFile, langId: string): Record<string, SignatureResult> {
    const sortedData = sortDataFile(data);
    const result: Record<string, SignatureResult> = {};
    for (const [, stanza] of Object.entries(sortedData)) {
        for (const item of stanza.items) {
            if (item.args === undefined) {
                continue;
            }

            const name = item.name;
            const weidu = isWeiduFormat(item);
            const label = getDetail(item, false);
            const parameters: SignatureParam[] = item.args.map((arg) => {
                const categoryPrefix = weidu ? getCategoryPrefix(arg.type) : "";
                const docStr = arg.doc ?? "";
                return {
                    label: arg.name,
                    documentation: markdown(
                        `${buildSignatureBlock(`${categoryPrefix}${arg.type} ${arg.name}`, langId)}\n${docStr}`,
                    ),
                };
            });

            const functionDoc = markdown(`---\n${item.doc ?? ""}`);
            result[name] = { label, documentation: functionDoc, parameters };
        }
    }
    return result;
}

/** Returns "INT_VAR " or "STR_VAR " prefix based on WeiDU type category. */
function getCategoryPrefix(type: string): string {
    const category = WEIDU_JSDOC_TYPES.get(type)?.category;
    if (category === "int") return "INT_VAR ";
    if (category === "str") return "STR_VAR ";
    return "";
}

// -- CLI entry point (tested via subprocess in generate-data-cli.test.ts) --

/* v8 ignore start -- CLI wrapper tested via execSync integration tests */
function main(): void {
    const { values } = parseArgs({
        options: {
            i: { type: "string", multiple: true, short: "i" },
            hover: { type: "string" },
            completion: { type: "string" },
            signature: { type: "string" },
            "tooltip-lang": { type: "string" },
        },
        strict: true,
    });

    const inputYaml = values.i;
    const hoverFile = values.hover;
    const completionFile = values.completion;
    const signatureFile = values.signature;
    const tooltipLangId = values["tooltip-lang"];

    if (
        inputYaml === undefined ||
        hoverFile === undefined ||
        completionFile === undefined ||
        tooltipLangId === undefined
    ) {
        console.error(
            "Usage: generate-data -i <yaml...> --completion <path> --hover <path> --tooltip-lang <id> [--signature <path>]",
        );
        process.exit(1);
    }

    const inputData = loadData(inputYaml);
    const completionData = generateCompletion(inputData, tooltipLangId);
    const hoverData = generateHover(inputData, tooltipLangId);

    fs.writeFileSync(hoverFile, JSON.stringify(hoverData, null, 4), "utf8");
    fs.writeFileSync(completionFile, JSON.stringify(completionData, null, 4), "utf8");

    if (signatureFile !== undefined) {
        const signatureData = generateSignatures(inputData, tooltipLangId);
        fs.writeFileSync(signatureFile, JSON.stringify(signatureData, null, 4), "utf8");
    }
}

const isDirectRun = process.argv[1]?.endsWith("generate-data.ts");
if (isDirectRun) {
    main();
}
/* v8 ignore stop */
