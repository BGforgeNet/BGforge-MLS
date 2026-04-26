/**
 * Sorts top-level YAML stanzas and stanza `items:` entries alphabetically
 * while preserving the original source text of each block.
 *
 * Usage:
 *   pnpm exec tsx scripts/utils/src/sort-yaml-stanzas-and-items.ts input.yml
 *   pnpm exec tsx scripts/utils/src/sort-yaml-stanzas-and-items.ts input.yml --sequence-path a.b.c --sort-key name
 */

import fs from "node:fs";
import { parseArgs } from "node:util";
import YAML, { isMap, isScalar, isSeq } from "yaml";
import { cmpStr, parseYamlDocStrict } from "./yaml-helpers.ts";

interface SourceTokenLike {
    readonly offset: number;
}

interface StanzaSlice {
    readonly key: string;
    readonly leading: string;
    readonly body: string;
}

interface TokenWithSource extends SourceTokenLike {
    readonly source: string;
    readonly type: string;
}

interface PairLike {
    readonly key: unknown;
    readonly srcToken?: unknown;
}

interface ItemSlice {
    readonly name: string;
    readonly text: string;
}

interface SeqLike {
    readonly items: readonly unknown[];
    readonly range?: readonly number[] | null;
    readonly srcToken?: unknown;
}

interface PairSrcToken {
    readonly start?: readonly TokenWithSource[];
    readonly sep?: readonly TokenWithSource[];
}

interface SequenceItemToken {
    readonly start?: readonly TokenWithSource[];
    readonly value?: { readonly offset?: number };
}

interface SequenceSrcToken {
    readonly items?: readonly SequenceItemToken[];
}

function isTokenWithSource(value: unknown): value is TokenWithSource {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const token = value as Partial<TokenWithSource>;
    return typeof token.offset === "number" && typeof token.source === "string" && typeof token.type === "string";
}

function getPairSrcToken(srcToken: unknown): PairSrcToken | undefined {
    if (typeof srcToken !== "object" || srcToken === null) {
        return undefined;
    }
    const token = srcToken as {
        readonly start?: readonly unknown[];
        readonly sep?: readonly unknown[];
    };
    const start = token.start?.every(isTokenWithSource) ? token.start : undefined;
    const sep = token.sep?.every(isTokenWithSource) ? token.sep : undefined;
    if (start === undefined && sep === undefined) {
        return undefined;
    }
    return { start, sep };
}

function getSequenceSrcToken(srcToken: unknown): SequenceSrcToken | undefined {
    if (typeof srcToken !== "object" || srcToken === null) {
        return undefined;
    }
    const token = srcToken as {
        readonly items?: readonly SequenceItemToken[];
    };
    if (token.items === undefined) {
        return undefined;
    }
    return { items: token.items };
}

function getStanzaStart(pair: PairLike): number {
    const startTokens = getPairSrcToken(pair.srcToken)?.start;
    if (startTokens !== undefined && startTokens.length > 0) {
        return startTokens[0]!.offset;
    }

    const keyStart = isScalar(pair.key) ? pair.key.range?.[0] : undefined;
    if (keyStart === undefined) {
        throw new Error("Encountered a top-level YAML pair without a key range");
    }
    return keyStart;
}

function getTopLevelName(item: unknown): string | undefined {
    if (!isMap(item)) {
        return undefined;
    }
    for (const pair of item.items) {
        if (
            isScalar(pair.key) &&
            pair.key.value === "name" &&
            isScalar(pair.value) &&
            typeof pair.value.value === "string"
        ) {
            return pair.value.value;
        }
    }
    return undefined;
}

function getItemsHeadEnd(pair: PairLike): number | undefined {
    const sepTokens = getPairSrcToken(pair.srcToken)?.sep;
    if (sepTokens === undefined) {
        return undefined;
    }
    for (const token of sepTokens) {
        if (token.type === "newline") {
            return token.offset + token.source.length;
        }
    }
    return undefined;
}

function getSequenceItemStart(item: {
    readonly start?: readonly TokenWithSource[];
    readonly value?: { readonly offset?: number };
}): number {
    const startTokens = item.start;
    if (startTokens !== undefined && startTokens.length > 0) {
        return startTokens[0]!.offset;
    }
    const start = item.value?.offset;
    if (start === undefined) {
        throw new Error("Encountered a YAML sequence item without a source range");
    }
    return start;
}

function getScalarField(item: unknown, fieldName: string): string | undefined {
    if (!isMap(item)) {
        return undefined;
    }
    for (const pair of item.items) {
        if (
            isScalar(pair.key) &&
            pair.key.value === fieldName &&
            isScalar(pair.value) &&
            typeof pair.value.value === "string"
        ) {
            return pair.value.value;
        }
    }
    return undefined;
}

function sortItemsInStanzaBody(body: string): string {
    const doc = YAML.parseDocument(body, { keepSourceTokens: true });
    if (doc.errors.length > 0 || !isMap(doc.contents) || doc.contents.items.length !== 1) {
        return body;
    }

    const stanzaPair = doc.contents.items[0]!;
    if (!isMap(stanzaPair.value)) {
        return body;
    }

    let result = body;
    for (const pair of [...stanzaPair.value.items].reverse()) {
        if (!isScalar(pair.key) || pair.key.value !== "items" || !isSeq(pair.value) || pair.value.items.length <= 1) {
            continue;
        }

        const pairStart = getStanzaStart(pair);
        const headEnd = getItemsHeadEnd(pair);
        const seqEnd = pair.value.range[2];
        const seqTokens = pair.value.srcToken?.items;
        if (headEnd === undefined || seqEnd === undefined) {
            continue;
        }

        const slices: ItemSlice[] = pair.value.items.map((item: unknown, index: number, items: readonly unknown[]) => {
            const name = getTopLevelName(item);
            if (name === undefined) {
                throw new Error("Expected each YAML items entry to have a top-level string name");
            }
            const start = index === 0 ? headEnd : getSequenceItemStart(seqTokens?.[index] ?? {});
            const nextItem = items[index + 1];
            const end = nextItem !== undefined ? getSequenceItemStart(seqTokens?.[index + 1] ?? {}) : seqEnd;
            return {
                name,
                text: result.slice(start, end),
            };
        });

        const sortedItems = [...slices]
            .sort((a, b) => cmpStr(a.name, b.name))
            .reduce((text, item, index) => {
                const itemText =
                    index === 0
                        ? item.text.replace(/^\n+/, "")
                        : item.text.startsWith("\n")
                          ? item.text
                          : `\n${item.text}`;
                return `${text}${itemText}`;
            }, "");
        const head = result.slice(pairStart, headEnd);
        result = `${result.slice(0, pairStart)}${head}${sortedItems}${result.slice(seqEnd)}`;
    }

    return result;
}

function sortSequenceItemsInSource(
    source: string,
    sequence: SeqLike,
    headEnd: number,
    seqEnd: number,
    sortKey: string,
): string {
    const seqTokens = getSequenceSrcToken(sequence.srcToken)?.items;

    // Separate items with the sort key from those without (e.g. include directives).
    // Items without the key keep their original order and are appended at the end.
    const sortable: ItemSlice[] = [];
    const rest: ItemSlice[] = [];
    for (let index = 0; index < sequence.items.length; index++) {
        const item = sequence.items[index]!;
        const name = getScalarField(item, sortKey);
        const start = index === 0 ? headEnd : getSequenceItemStart(seqTokens?.[index] ?? {});
        const nextItem = sequence.items[index + 1];
        const end = nextItem !== undefined ? getSequenceItemStart(seqTokens?.[index + 1] ?? {}) : seqEnd;
        const slice = { name: name ?? "", text: source.slice(start, end) };
        if (name !== undefined) {
            sortable.push(slice);
        } else {
            rest.push(slice);
        }
    }

    const all = [...[...sortable].sort((a, b) => cmpStr(a.name, b.name)), ...rest];
    return all.reduce((text, item) => {
        const compactText = item.text.replace(/^\n+/, "").replace(/\n+$/, "\n");
        return `${text}${compactText}`;
    }, "");
}

export function sortYamlSequenceByPath(source: string, path: readonly string[], sortKey: string): string {
    const doc = parseYamlDocStrict(source, { keepSourceTokens: true });
    if (!isMap(doc.contents)) {
        throw new Error("Expected top-level YAML document to be a mapping");
    }
    if (path.length === 0) {
        return source;
    }

    const target = doc.getIn(path, true);
    if (!isSeq(target) || target.items.length <= 1) {
        return source;
    }

    const parentPath = path.slice(0, -1);
    const finalKey = path[path.length - 1]!;
    const parent = doc.getIn(parentPath, true);
    if (!isMap(parent)) {
        return source;
    }

    const pair = parent.items.find((item) => isScalar(item.key) && item.key.value === finalKey);
    if (pair === undefined || !isSeq(pair.value)) {
        return source;
    }

    const pairStart = getStanzaStart(pair);
    const headEnd = getItemsHeadEnd(pair);
    const seqEnd = pair.value.range?.[2];
    if (headEnd === undefined || seqEnd === undefined) {
        return source;
    }

    const sortedItems = sortSequenceItemsInSource(source, pair.value, headEnd, seqEnd, sortKey);
    const head = source.slice(pairStart, headEnd);
    return `${source.slice(0, pairStart)}${head}${sortedItems}${source.slice(seqEnd)}`;
}

/**
 * Sorts a named sequence (e.g. `patterns`) within every entry of a map at the
 * given path. Useful for sorting `patterns` inside all `repository` stanzas of
 * a TextMate grammar without reordering the stanzas themselves.
 */
export function sortSequenceInAllMapEntries(
    source: string,
    mapPath: readonly string[],
    sequenceKey: string,
    sortKey: string,
): string {
    const doc = parseYamlDocStrict(source, { keepSourceTokens: true });
    if (!isMap(doc.contents)) {
        throw new Error("Expected top-level YAML document to be a mapping");
    }
    const map = mapPath.length === 0 ? doc.contents : doc.getIn(mapPath, true);
    if (!isMap(map)) {
        return source;
    }

    const keys: string[] = [];
    for (const pair of map.items) {
        if (isScalar(pair.key) && typeof pair.key.value === "string") {
            keys.push(pair.key.value);
        }
    }

    // Process in reverse order so changes to later stanzas don't shift offsets
    // of earlier ones on subsequent iterations.
    let result = source;
    for (const key of [...keys].reverse()) {
        result = sortYamlSequenceByPath(result, [...mapPath, key, sequenceKey], sortKey);
    }
    return result;
}

export function sortYamlStanzasAndItems(source: string): string {
    const doc = parseYamlDocStrict(source, { keepSourceTokens: true });
    if (!isMap(doc.contents)) {
        throw new Error("Expected top-level YAML document to be a mapping");
    }

    const stanzas = doc.contents.items.map((pair, index, items): StanzaSlice => {
        if (!isScalar(pair.key) || typeof pair.key.value !== "string") {
            throw new Error("Expected all top-level YAML keys to be scalar strings");
        }

        const start = getStanzaStart(pair);
        const keyStart = pair.key.range?.[0];
        if (keyStart === undefined) {
            throw new Error("Encountered a top-level YAML key without a source range");
        }
        const nextPair = items[index + 1];
        const end = nextPair !== undefined ? getStanzaStart(nextPair) : doc.range[2];
        return {
            key: pair.key.value,
            leading: source.slice(start, keyStart),
            // Strip trailing blank lines — they belong to the gap between
            // stanzas in the original order and must not travel with the body
            // when stanzas are reordered.
            body: sortItemsInStanzaBody(source.slice(keyStart, end)).replace(/\n{2,}$/, "\n"),
        };
    });

    const firstStart = getStanzaStart(doc.contents.items[0]!);
    const prefix = source.slice(0, firstStart);
    const sorted = [...stanzas].sort((a, b) => cmpStr(a.key, b.key));

    return sorted.reduce((result, stanza, index) => {
        const leading =
            index === 0 ? stanza.leading.replace(/^\n+/, "") : stanza.leading.length > 0 ? stanza.leading : "\n";
        return `${result}${leading}${stanza.body}`;
    }, prefix);
}

/* v8 ignore start -- CLI wrapper tested via execSync integration tests */
function main(): void {
    const { positionals, values } = parseArgs({
        args: process.argv.slice(2),
        options: {
            "sequence-path": { type: "string" },
            "map-path": { type: "string" },
            "sequence-key": { type: "string" },
            "sort-key": { type: "string" },
        },
        allowPositionals: true,
        strict: true,
    });

    const inputFile = positionals[0];
    if (inputFile === undefined) {
        console.error(
            "Usage: sort-yaml-stanzas-and-items <input.yml>\n" +
                "       sort-yaml-stanzas-and-items <input.yml> --sequence-path a.b.c --sort-key key\n" +
                "       sort-yaml-stanzas-and-items <input.yml> --map-path a.b --sequence-key patterns --sort-key match",
        );
        process.exit(1);
    }

    const source = fs.readFileSync(inputFile, "utf8");
    const sequencePath = values["sequence-path"];
    const mapPath = values["map-path"];
    const sequenceKey = values["sequence-key"];
    const sortKey = values["sort-key"];

    let sorted: string;
    if (mapPath !== undefined || sequenceKey !== undefined) {
        if (mapPath === undefined || sequenceKey === undefined || sortKey === undefined) {
            console.error("--map-path, --sequence-key and --sort-key must all be provided together");
            process.exit(1);
        }
        sorted = sortSequenceInAllMapEntries(source, mapPath.split("."), sequenceKey, sortKey);
    } else if (sequencePath !== undefined || sortKey !== undefined) {
        if (sequencePath === undefined || sortKey === undefined) {
            console.error("Both --sequence-path and --sort-key must be provided together");
            process.exit(1);
        }
        sorted = sortYamlSequenceByPath(source, sequencePath.split("."), sortKey);
    } else {
        sorted = sortYamlStanzasAndItems(source);
    }
    fs.writeFileSync(inputFile, sorted, "utf8");
}

const isDirectRun = process.argv[1]?.endsWith("sort-yaml-stanzas-and-items.ts");
if (isDirectRun) {
    main();
}
/* v8 ignore stop */
