/**
 * BinaryDocument: custom document model for the binary editor.
 * Holds the current ParseResult and raw bytes, supports editing fields,
 * and integrates with VSCode's undo/redo via CustomDocumentEditEvent.
 */

import * as vscode from "vscode";
import { conlog } from "../logging";
import type { BinaryParser, ParseOptions, ParseResult, ParsedField, ParsedGroup } from "../parsers";
import { formatAdapterRegistry, type BinaryFormatAdapter } from "../parsers/format-adapter";

/**
 * Represents a single field edit for undo/redo.
 */
export interface FieldEdit {
    readonly fieldId: string;
    readonly fieldPath: string;
    readonly oldRawValue: number;
    readonly oldDisplayValue: string;
    readonly newRawValue: number;
    readonly newDisplayValue: string;
    readonly incrementalSafe: boolean;
}

interface BinaryDocumentCodec {
    readonly serialize: NonNullable<BinaryParser["serialize"]>;
    readonly parse?: (data: Uint8Array, options?: ParseOptions) => ParseResult;
    readonly parseOptions?: ParseOptions;
}

/**
 * Custom document for binary files handled by a registered parser.
 * Manages parsed state and exposes an edit API.
 */
export class BinaryDocument implements vscode.CustomDocument {
    readonly uri: vscode.Uri;
    private _parseResult: ParseResult;
    private readonly codec: BinaryDocumentCodec;

    private readonly _onDidDispose = new vscode.EventEmitter<void>();
    readonly onDidDispose = this._onDidDispose.event;

    private readonly _onDidChange = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<BinaryDocument>>();
    /** VSCode listens to this for dirty state and undo/redo */
    readonly onDidChange = this._onDidChange.event;

    private readonly _onDidChangeContent = new vscode.EventEmitter<void>();
    /** Internal event: content changed, webview should refresh */
    readonly onDidChangeContent = this._onDidChangeContent.event;

    constructor(
        uri: vscode.Uri,
        parseResult: ParseResult,
        codec: BinaryDocumentCodec | NonNullable<BinaryParser["serialize"]>,
    ) {
        this.uri = uri;
        this._parseResult = parseResult;
        this.codec = typeof codec === "function" ? { serialize: codec } : codec;
    }

    get parseResult(): ParseResult {
        return this._parseResult;
    }

    getFieldById(fieldId: string): ParsedField | undefined {
        return this.findFieldById(fieldId);
    }

    /**
     * Serialize the current state back to binary bytes.
     */
    getContent(): Uint8Array {
        return this.codec.serialize(this._parseResult);
    }

    /**
     * Reset to a freshly-parsed result (used by revert).
     */
    reset(parseResult: ParseResult): void {
        this._parseResult = parseResult;
        this._onDidChangeContent.fire();
    }

    replaceParseResult(parseResult: ParseResult, label: string): void {
        const previousParseResult = cloneParseResult(this._parseResult);
        const nextParseResult = cloneParseResult(parseResult);
        this._parseResult = cloneParseResult(nextParseResult);

        this._onDidChange.fire({
            document: this,
            label,
            undo: () => {
                this._parseResult = cloneParseResult(previousParseResult);
                this._onDidChangeContent.fire();
            },
            redo: () => {
                this._parseResult = cloneParseResult(nextParseResult);
                this._onDidChangeContent.fire();
            },
        });

        this._onDidChangeContent.fire();
    }

    /**
     * Apply an edit to a field. Fires onDidChange for VSCode undo integration.
     * Returns the edit if successful, undefined if field not found.
     */
    applyEdit(fieldId: string, fieldPath: string, newRawValue: number, newDisplayValue: string): FieldEdit | undefined {
        const adapter = formatAdapterRegistry.get(this._parseResult.format);
        if (adapter?.isStructuralFieldId?.(fieldId) && this.codec.parse) {
            return this.applyStructuralEdit(adapter, fieldId, fieldPath, newRawValue, newDisplayValue);
        }

        const field = this.findFieldById(fieldId);
        if (!field) return undefined;

        const oldRawValue =
            typeof field.rawValue === "number" ? field.rawValue : typeof field.value === "number" ? field.value : 0;
        const oldDisplayValue = String(field.value);

        const edit: FieldEdit = {
            fieldId,
            fieldPath,
            oldRawValue,
            oldDisplayValue,
            newRawValue,
            newDisplayValue,
            incrementalSafe: true,
        };

        // Apply the edit
        this.setFieldValue(field, newRawValue, newDisplayValue);

        // Fire VSCode edit event with undo/redo callbacks.
        // The label is shown in VSCode's Edit > Undo menu.
        this._onDidChange.fire({
            document: this,
            label: `Edit ${fieldPath}`,
            undo: () => {
                this.setFieldValueById(fieldId, oldRawValue, oldDisplayValue);
                this._onDidChangeContent.fire();
            },
            redo: () => {
                this.setFieldValueById(fieldId, newRawValue, newDisplayValue);
                this._onDidChangeContent.fire();
            },
        });

        this._onDidChangeContent.fire();
        return edit;
    }

    private findFieldById(fieldId: string): ParsedField | undefined {
        try {
            const parts = JSON.parse(fieldId) as unknown;
            if (!Array.isArray(parts) || !parts.every((part) => typeof part === "string")) {
                return undefined;
            }
            return findFieldBySegments(this._parseResult.root, parts, 0);
        } catch {
            return undefined;
        }
    }

    private applyStructuralEdit(
        adapter: BinaryFormatAdapter,
        fieldId: string,
        fieldPath: string,
        newRawValue: number,
        newDisplayValue: string,
    ): FieldEdit | undefined {
        const field = this.findFieldById(fieldId);
        if (!field || !this.codec.parse) {
            return undefined;
        }

        const oldRawValue =
            typeof field.rawValue === "number" ? field.rawValue : typeof field.value === "number" ? field.value : 0;
        const oldDisplayValue = String(field.value);
        const nextBytes = adapter.buildStructuralTransitionBytes?.(this._parseResult, fieldId, newRawValue);
        if (!nextBytes) {
            return undefined;
        }

        const reparsed = this.codec.parse(nextBytes, this.codec.parseOptions);
        if (reparsed.errors && reparsed.errors.length > 0) {
            return undefined;
        }

        const previousParseResult = cloneParseResult(this._parseResult);
        const nextParseResult = cloneParseResult(reparsed);
        this._parseResult = cloneParseResult(nextParseResult);

        const edit: FieldEdit = {
            fieldId,
            fieldPath,
            oldRawValue,
            oldDisplayValue,
            newRawValue,
            newDisplayValue,
            incrementalSafe: false,
        };

        this._onDidChange.fire({
            document: this,
            label: `Edit ${fieldPath}`,
            undo: () => {
                this._parseResult = cloneParseResult(previousParseResult);
                this._onDidChangeContent.fire();
            },
            redo: () => {
                this._parseResult = cloneParseResult(nextParseResult);
                this._onDidChangeContent.fire();
            },
        });

        this._onDidChangeContent.fire();
        return edit;
    }

    /**
     * Set a field's raw and display values.
     */
    private setFieldValue(field: ParsedField, rawValue: number, displayValue: string): void {
        // Mutating in-place is intentional here: the ParseResult tree is owned
        // by this document, and immutable copies would require rebuilding the
        // entire tree for every edit. Since PRO files are small and the tree
        // is never shared, in-place updates are safe and much simpler.
        (field as { value: unknown }).value = displayValue;
        (field as { rawValue?: number | string }).rawValue = rawValue;
        this.refreshCanonicalDocument();
    }

    private setFieldValueById(fieldId: string, rawValue: number, displayValue: string): void {
        const field = this.findFieldById(fieldId);
        if (!field) {
            return;
        }
        this.setFieldValue(field, rawValue, displayValue);
    }

    private refreshCanonicalDocument(): void {
        try {
            const adapter = formatAdapterRegistry.get(this._parseResult.format);
            if (adapter) {
                this._parseResult.document = adapter.rebuildCanonicalDocument(
                    this._parseResult,
                ) as ParseResult["document"];
            }
        } catch (err) {
            conlog(
                `Binary editor: failed to rebuild canonical document for ${this._parseResult.format}: ${err instanceof Error ? err.message : String(err)}`,
                "warn",
            );
            this._parseResult.document = undefined;
        }
    }

    dispose(): void {
        this._onDidDispose.fire();
        this._onDidDispose.dispose();
        this._onDidChange.dispose();
        this._onDidChangeContent.dispose();
    }
}

function cloneParseResult(parseResult: ParseResult): ParseResult {
    const cloned = structuredClone(parseResult);
    if (parseResult.sourceData) {
        cloned.sourceData = new Uint8Array(parseResult.sourceData);
    }
    return cloned;
}

function findFieldBySegments(group: ParsedGroup, pathParts: readonly string[], depth: number): ParsedField | undefined {
    if (depth >= pathParts.length) {
        return undefined;
    }

    for (const entry of group.fields) {
        if ("fields" in entry) {
            if (entry.name !== pathParts[depth]) {
                continue;
            }
            const result = findFieldBySegments(entry, pathParts, depth + 1);
            if (result) {
                return result;
            }
            continue;
        }

        if (depth === pathParts.length - 1 && entry.name === pathParts[depth]) {
            return entry;
        }
    }

    return undefined;
}
