import {
    type CompletionItem,
    CompletionItemKind,
    type DocumentSymbol,
    type FoldingRange,
    FoldingRangeKind,
    type Location,
    MarkupKind,
    type Position,
    type Range,
    type SymbolInformation,
    SymbolKind as VscodeSymbolKind,
    type TextEdit,
    type WorkspaceEdit,
} from "vscode-languageserver/node";
import type { Node as SyntaxNode } from "web-tree-sitter";
import { createFullDocumentEdit } from "../shared/format-edits";
import type { FormatResult } from "../language-provider";
import { computeDisplayPath, extractFilename } from "../core/location-utils";
import { type ParseResult, EMPTY_PARSE_RESULT } from "../core/parse-result";
import type { ReferencesIndex } from "../shared/references-index";
import type { SemanticTokenSpan } from "../shared/semantic-tokens";
import { ScopeLevel, SourceType, SymbolKind, symbolKindToCompletionKind, type IndexedSymbol } from "../core/symbol";
import { parseWithCache } from "../../../shared/parsers/lua";

interface NameNode {
    readonly name: string;
    readonly range: Range;
}

interface LuaDef {
    readonly name: string;
    readonly kind: SymbolKind.Function | SymbolKind.Variable;
    readonly range: Range;
    readonly detail: string;
}

const LUA_KEYWORDS: ReadonlySet<string> = new Set([
    "and",
    "break",
    "do",
    "else",
    "elseif",
    "end",
    "false",
    "for",
    "function",
    "if",
    "in",
    "local",
    "nil",
    "not",
    "or",
    "repeat",
    "return",
    "then",
    "true",
    "until",
    "while",
]);

function makeRange(node: SyntaxNode): Range {
    return {
        start: { line: node.startPosition.row, character: node.startPosition.column },
        end: { line: node.endPosition.row, character: node.endPosition.column },
    };
}

function isIdentifier(name: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

function isKeyword(name: string): boolean {
    return LUA_KEYWORDS.has(name);
}

function firstIdentifier(node: SyntaxNode): SyntaxNode | null {
    if (node.childCount === 0) {
        return node.type === "identifier" ? node : null;
    }
    for (const child of node.children) {
        const found = firstIdentifier(child);
        if (found) {
            return found;
        }
    }
    return null;
}

function collectIdentifiers(node: SyntaxNode, output: NameNode[]): void {
    if (node.type === "identifier") {
        const name = node.text;
        if (isIdentifier(name) && !isKeyword(name)) {
            output.push({ name, range: makeRange(node) });
        }
        return;
    }
    for (const child of node.children) {
        collectIdentifiers(child, output);
    }
}

function nodeAtPosition(root: SyntaxNode, position: Position): SyntaxNode | null {
    let cursor: SyntaxNode | null = root;
    while (cursor) {
        let matchedChild: SyntaxNode | null = null;
        for (const child of cursor.children) {
            const start = child.startPosition;
            const end = child.endPosition;
            const afterStart =
                position.line > start.row || (position.line === start.row && position.character >= start.column);
            const beforeEnd =
                position.line < end.row || (position.line === end.row && position.character <= end.column);
            if (afterStart && beforeEnd) {
                matchedChild = child;
                break;
            }
        }
        if (!matchedChild) {
            return cursor;
        }
        cursor = matchedChild;
    }
    return null;
}

function identifierAtPosition(root: SyntaxNode, position: Position): NameNode | null {
    const node = nodeAtPosition(root, position);
    if (!node) {
        return null;
    }

    if (node.type === "identifier") {
        const name = node.text;
        if (isIdentifier(name) && !isKeyword(name)) {
            return { name, range: makeRange(node) };
        }
        return null;
    }

    const id = firstIdentifier(node);
    if (!id) {
        return null;
    }
    const name = id.text;
    if (!isIdentifier(name) || isKeyword(name)) {
        return null;
    }
    return { name, range: makeRange(id) };
}

function collectDefinitions(root: SyntaxNode): readonly LuaDef[] {
    const defs: LuaDef[] = [];

    const visit = (node: SyntaxNode): void => {
        if (node.type === "function_declaration" || node.type === "function_definition") {
            const named = node.childForFieldName("name") ?? firstIdentifier(node);
            if (named) {
                const full = named.text;
                const name = full.split(/[.:]/).at(-1) ?? full;
                if (isIdentifier(name) && !isKeyword(name)) {
                    const range = makeRange(named);
                    defs.push({
                        name,
                        kind: SymbolKind.Function,
                        range,
                        detail: `function ${full}`,
                    });
                }
            }
        }

        if (node.type === "variable_declaration") {
            const nameNode = node.childForFieldName("name") ?? firstIdentifier(node);
            if (nameNode) {
                const name = nameNode.text;
                if (isIdentifier(name) && !isKeyword(name)) {
                    defs.push({
                        name,
                        kind: SymbolKind.Variable,
                        range: makeRange(nameNode),
                        detail: `local ${name}`,
                    });
                }
            }
        }

        for (const child of node.children) {
            visit(child);
        }
    };

    visit(root);
    return defs;
}

function definitionMap(defs: readonly LuaDef[]): ReadonlyMap<string, readonly LuaDef[]> {
    const map = new Map<string, LuaDef[]>();
    for (const def of defs) {
        let items = map.get(def.name);
        if (!items) {
            items = [];
            map.set(def.name, items);
        }
        items.push(def);
    }
    return map;
}

function toIndexedSymbol(def: LuaDef, uri: string, displayPath: string): IndexedSymbol {
    if (def.kind === SymbolKind.Function) {
        return {
            name: def.name,
            kind: SymbolKind.Function,
            location: { uri, range: def.range },
            scope: { level: ScopeLevel.File },
            source: { type: SourceType.Navigation, uri, displayPath },
            completion: {
                label: def.name,
                kind: symbolKindToCompletionKind(SymbolKind.Function),
                detail: def.detail,
                labelDetails: { description: displayPath },
            },
            hover: {
                contents: {
                    kind: MarkupKind.Markdown,
                    value: `\`\`\`lua\n${def.detail}\n\`\`\`\n\nFrom: ${displayPath}`,
                },
            },
            callable: {},
        };
    }

    return {
        name: def.name,
        kind: SymbolKind.Variable,
        location: { uri, range: def.range },
        scope: { level: ScopeLevel.File },
        source: { type: SourceType.Document, uri, displayPath },
        completion: {
            label: def.name,
            kind: symbolKindToCompletionKind(SymbolKind.Variable),
            detail: def.detail,
            labelDetails: { description: displayPath },
        },
        hover: {
            contents: {
                kind: MarkupKind.Markdown,
                value: `\`\`\`lua\n${def.detail}\n\`\`\`\n\nFrom: ${displayPath}`,
            },
        },
        variable: {},
    };
}

export function parseLuaFile(uri: string, text: string, workspaceRoot?: string): ParseResult {
    const tree = parseWithCache(text);
    if (!tree) {
        return EMPTY_PARSE_RESULT;
    }

    const displayPath = computeDisplayPath(uri, workspaceRoot) || extractFilename(uri);
    const defs = collectDefinitions(tree.rootNode);
    const symbols = defs.map((def) => toIndexedSymbol(def, uri, displayPath));

    const names: NameNode[] = [];
    collectIdentifiers(tree.rootNode, names);

    const refs = new Map<string, Location[]>();
    for (const nameNode of names) {
        let locs = refs.get(nameNode.name);
        if (!locs) {
            locs = [];
            refs.set(nameNode.name, locs);
        }
        locs.push({ uri, range: nameNode.range });
    }

    return { symbols, refs };
}

export function getLocalSymbol(
    name: string,
    text: string,
    uri: string,
    workspaceRoot?: string,
): IndexedSymbol | undefined {
    const parsed = parseLuaFile(uri, text, workspaceRoot);
    return parsed.symbols.find((symbol) => symbol.name === name);
}

export function getDocumentSymbols(text: string): DocumentSymbol[] {
    const tree = parseWithCache(text);
    if (!tree) {
        return [];
    }
    const defs = collectDefinitions(tree.rootNode);
    return defs.map((def) => ({
        name: def.name,
        kind: def.kind === SymbolKind.Function ? VscodeSymbolKind.Function : VscodeSymbolKind.Variable,
        range: def.range,
        selectionRange: def.range,
        detail: def.detail,
    }));
}

export function definition(text: string, uri: string, position: Position): Location | null {
    const tree = parseWithCache(text);
    if (!tree) {
        return null;
    }
    const target = identifierAtPosition(tree.rootNode, position);
    if (!target) {
        return null;
    }

    const defs = collectDefinitions(tree.rootNode);
    const byName = definitionMap(defs);
    const candidates = byName.get(target.name);
    if (!candidates || candidates.length === 0) {
        return null;
    }

    const prior = candidates
        .filter((item) => item.range.start.line <= position.line)
        .sort((a, b) => b.range.start.line - a.range.start.line);
    const selected = prior[0] ?? candidates[0];
    return selected ? { uri, range: selected.range } : null;
}

export function findReferences(
    text: string,
    position: Position,
    uri: string,
    includeDeclaration: boolean,
    refsIndex?: ReferencesIndex,
): Location[] {
    const tree = parseWithCache(text);
    if (!tree) {
        return [];
    }

    const target = identifierAtPosition(tree.rootNode, position);
    if (!target) {
        return [];
    }

    const defs = collectDefinitions(tree.rootNode).filter((item) => item.name === target.name);
    const defRanges = new Set(defs.map((item) => `${item.range.start.line}:${item.range.start.character}`));

    const names: NameNode[] = [];
    collectIdentifiers(tree.rootNode, names);
    const local = names
        .filter((item) => item.name === target.name)
        .filter(
            (item) => includeDeclaration || !defRanges.has(`${item.range.start.line}:${item.range.start.character}`),
        )
        .map((item) => ({ uri, range: item.range }));

    if (!refsIndex) {
        return local;
    }
    return [...local, ...refsIndex.lookup(target.name).filter((location) => location.uri !== uri)];
}

export function prepareRename(text: string, position: Position): { range: Range; placeholder: string } | null {
    const tree = parseWithCache(text);
    if (!tree) {
        return null;
    }
    const target = identifierAtPosition(tree.rootNode, position);
    if (!target) {
        return null;
    }
    return { range: target.range, placeholder: target.name };
}

export function rename(
    text: string,
    position: Position,
    newName: string,
    uri: string,
    refsIndex?: ReferencesIndex,
): WorkspaceEdit | null {
    if (!isIdentifier(newName) || isKeyword(newName)) {
        return null;
    }

    const tree = parseWithCache(text);
    if (!tree) {
        return null;
    }
    const target = identifierAtPosition(tree.rootNode, position);
    if (!target) {
        return null;
    }

    const names: NameNode[] = [];
    collectIdentifiers(tree.rootNode, names);

    const editsByUri = new Map<string, TextEdit[]>();
    const add = (editUri: string, range: Range): void => {
        let edits = editsByUri.get(editUri);
        if (!edits) {
            edits = [];
            editsByUri.set(editUri, edits);
        }
        edits.push({ range, newText: newName });
    };

    for (const item of names) {
        if (item.name === target.name) {
            add(uri, item.range);
        }
    }

    if (refsIndex) {
        for (const location of refsIndex.lookup(target.name)) {
            if (location.uri !== uri) {
                add(location.uri, location.range);
            }
        }
    }

    if (editsByUri.size === 0) {
        return null;
    }

    const changes: Record<string, TextEdit[]> = {};
    for (const [editUri, edits] of editsByUri.entries()) {
        changes[editUri] = edits;
    }
    return { changes };
}

export function getSemanticTokenSpans(text: string): SemanticTokenSpan[] {
    const tree = parseWithCache(text);
    if (!tree) {
        return [];
    }

    const defs = collectDefinitions(tree.rootNode);
    const parameters = new Set(
        defs
            .filter((def) => def.detail.startsWith("param "))
            .map((def) => `${def.range.start.line}:${def.range.start.character}`),
    );

    const names: NameNode[] = [];
    collectIdentifiers(tree.rootNode, names);

    return names.map((item) => ({
        line: item.range.start.line,
        startChar: item.range.start.character,
        length: item.range.end.character - item.range.start.character,
        tokenType: parameters.has(`${item.range.start.line}:${item.range.start.character}`) ? "parameter" : "variable",
        tokenModifiers: 0,
    }));
}

export function luaFoldingRanges(text: string): FoldingRange[] {
    const tree = parseWithCache(text);
    if (!tree) {
        return [];
    }

    const ranges: FoldingRange[] = [];
    const foldable = new Set([
        "function_declaration",
        "function_definition",
        "if_statement",
        "for_statement",
        "while_statement",
        "repeat_statement",
        "do_statement",
        "table_constructor",
        "comment",
    ]);

    const visit = (node: SyntaxNode): void => {
        if (node.endPosition.row > node.startPosition.row && foldable.has(node.type)) {
            ranges.push({
                startLine: node.startPosition.row,
                endLine: node.endPosition.row,
                kind: node.type === "comment" ? FoldingRangeKind.Comment : undefined,
            });
        }
        for (const child of node.children) {
            visit(child);
        }
    };

    visit(tree.rootNode);
    return ranges;
}

export function formatLua(text: string): FormatResult {
    const normalized = text
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .join("\n");
    return { edits: createFullDocumentEdit(text, normalized) };
}

export function mergeLocalCompletions(
    items: readonly CompletionItem[],
    text: string,
    uri: string,
    workspaceRoot?: string,
): CompletionItem[] {
    const local = parseLuaFile(uri, text, workspaceRoot).symbols.map((symbol) => ({
        label: symbol.name,
        kind: symbol.kind === SymbolKind.Function ? CompletionItemKind.Function : CompletionItemKind.Variable,
        detail: symbol.completion.detail,
    }));

    const localNames = new Set(local.map((item) => item.label));
    const filtered = items.filter((item) => !localNames.has(item.label as string));
    return [...local, ...filtered];
}

export function workspaceSymbolsFromText(query: string, text: string, uri: string): readonly SymbolInformation[] {
    const tree = parseWithCache(text);
    if (!tree) {
        return [];
    }

    const needle = query.trim().toLowerCase();
    const defs = collectDefinitions(tree.rootNode);
    return defs
        .filter((def) => needle.length === 0 || def.name.toLowerCase().includes(needle))
        .map((def) => ({
            name: def.name,
            kind: def.kind === SymbolKind.Function ? VscodeSymbolKind.Function : VscodeSymbolKind.Variable,
            location: {
                uri,
                range: def.range,
            },
        }));
}
