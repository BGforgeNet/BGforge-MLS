/**
 * BinaryDocument: custom document model for the binary editor.
 * Holds the current ParseResult and raw bytes, supports editing fields,
 * and integrates with VSCode's undo/redo via CustomDocumentEditEvent.
 */

import * as vscode from "vscode";
import { conlog } from "../logging";
import {
    type BinaryParser,
    type ParseOptions,
    type ParseResult,
    type ParsedField,
    type BinaryFormatAdapter,
    formatAdapterRegistry,
    findEditableField,
} from "@bgforge/binary";

/**
 * Outcome of an add/remove operation on a variable-length array.
 * Carries the user-visible label so commands can echo it; absence (`undefined`)
 * means the operation didn't apply (unknown path, parse rejected, etc.).
 */
export interface EntityOperationResult {
    readonly label: string;
}

/**
 * Represents a single field edit for undo/redo.
 */
export interface FieldEdit {
    readonly fieldId: string;
    readonly fieldPath: string;
    /** Numeric for int/uint/enum/flags fields; string for fixed-width string fields. */
    readonly oldRawValue: number | string;
    readonly oldDisplayValue: string;
    readonly newRawValue: number | string;
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
    applyEdit(
        fieldId: string,
        fieldPath: string,
        newRawValue: number | string,
        newDisplayValue: string,
    ): FieldEdit | undefined {
        const adapter = formatAdapterRegistry.get(this._parseResult.format);
        if (adapter?.isStructuralFieldId?.(fieldId) && this.codec.parse) {
            // Structural edits only fire for numeric fields whose change rebuilds parts of the
            // tree (e.g., enum-driven section reshapes). Strings never sit on that pathway.
            if (typeof newRawValue !== "number") return undefined;
            return this.applyStructuralEdit(adapter, fieldId, fieldPath, newRawValue, newDisplayValue);
        }

        const field = this.findFieldById(fieldId);
        if (!field) return undefined;

        const oldRawValue: number | string =
            field.type === "string"
                ? typeof field.value === "string"
                    ? field.value
                    : ""
                : typeof field.rawValue === "number"
                  ? field.rawValue
                  : typeof field.value === "number"
                    ? field.value
                    : 0;
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

    /**
     * Resolve a `fieldId` to its leaf `ParsedField` for mutation purposes.
     *
     * Delegates to the binary package's `findEditableField`, which returns
     * `undefined` when any group on the path carries `editingLocked: true`.
     * That flag is the parser's statement that the surrounding record's wire
     * layout couldn't be fully decoded, so width-preserving field changes
     * inside it are not safe — the helper is the canonical API gate every
     * edit path runs through.
     */
    private findFieldById(fieldId: string): ParsedField | undefined {
        return findEditableField(this._parseResult.root, fieldId);
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

        if (!this.applyByteRebuild(nextBytes, `Edit ${fieldPath}`)) {
            return undefined;
        }

        return {
            fieldId,
            fieldPath,
            oldRawValue,
            oldDisplayValue,
            newRawValue,
            newDisplayValue,
            incrementalSafe: false,
        };
    }

    /**
     * Reparse `nextBytes`, swap it in as the current parse result, and fire the
     * VSCode edit event with undo/redo callbacks. Shared by every byte-rebuild
     * path (structural field edits, add/remove entry). Returns false if the
     * reparse fails so the caller can short-circuit.
     */
    private applyByteRebuild(nextBytes: Uint8Array, label: string): boolean {
        if (!this.codec.parse) {
            return false;
        }
        const reparsed = this.codec.parse(nextBytes, this.codec.parseOptions);
        if (reparsed.errors && reparsed.errors.length > 0) {
            return false;
        }

        const previousParseResult = cloneParseResult(this._parseResult);
        const nextParseResult = cloneParseResult(reparsed);
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
        return true;
    }

    /**
     * Append a default entry to the variable-length array at `arrayPath`
     * (tree-segment names). Returns the operation result on success; undefined
     * when the format/path doesn't support the operation or the rebuild fails.
     */
    addEntity(arrayPath: readonly string[]): EntityOperationResult | undefined {
        const adapter = formatAdapterRegistry.get(this._parseResult.format);
        const nextBytes = adapter?.buildAddEntryBytes?.(this._parseResult, arrayPath);
        if (!nextBytes) return undefined;
        const label = `Add entry to ${arrayPath.join(" / ")}`;
        return this.applyByteRebuild(nextBytes, label) ? { label } : undefined;
    }

    /** Remove the entry at `entryPath` (full tree-segment path including the entry name). */
    removeEntity(entryPath: readonly string[]): EntityOperationResult | undefined {
        const adapter = formatAdapterRegistry.get(this._parseResult.format);
        const nextBytes = adapter?.buildRemoveEntryBytes?.(this._parseResult, entryPath);
        if (!nextBytes) return undefined;
        const label = `Remove ${entryPath.join(" / ")}`;
        return this.applyByteRebuild(nextBytes, label) ? { label } : undefined;
    }

    /** Insert a new default entry directly before `entryPath`. */
    insertEntityBefore(entryPath: readonly string[]): EntityOperationResult | undefined {
        return this.insertEntity(entryPath, "before");
    }

    /** Insert a new default entry directly after `entryPath`. */
    insertEntityAfter(entryPath: readonly string[]): EntityOperationResult | undefined {
        return this.insertEntity(entryPath, "after");
    }

    private insertEntity(
        entryPath: readonly string[],
        position: "before" | "after",
    ): EntityOperationResult | undefined {
        const adapter = formatAdapterRegistry.get(this._parseResult.format);
        const nextBytes = adapter?.buildInsertEntryBytes?.(this._parseResult, entryPath, position);
        if (!nextBytes) return undefined;
        const label = `Insert ${position} ${entryPath.join(" / ")}`;
        return this.applyByteRebuild(nextBytes, label) ? { label } : undefined;
    }

    /** Swap the entry at `entryPath` with its predecessor. */
    moveEntityUp(entryPath: readonly string[]): EntityOperationResult | undefined {
        return this.moveEntity(entryPath, "up");
    }

    /** Swap the entry at `entryPath` with its successor. */
    moveEntityDown(entryPath: readonly string[]): EntityOperationResult | undefined {
        return this.moveEntity(entryPath, "down");
    }

    private moveEntity(entryPath: readonly string[], direction: "up" | "down"): EntityOperationResult | undefined {
        const adapter = formatAdapterRegistry.get(this._parseResult.format);
        const nextBytes = adapter?.buildMoveEntryBytes?.(this._parseResult, entryPath, direction);
        if (!nextBytes) return undefined;
        const label = `Move ${entryPath.join(" / ")} ${direction}`;
        return this.applyByteRebuild(nextBytes, label) ? { label } : undefined;
    }

    /**
     * Set a field's raw and display values.
     */
    private setFieldValue(field: ParsedField, rawValue: number | string, displayValue: string): void {
        // Mutating in-place is intentional here: the ParseResult tree is owned
        // by this document, and immutable copies would require rebuilding the
        // entire tree for every edit. Since PRO files are small and the tree
        // is never shared, in-place updates are safe and much simpler.
        // For string-typed fields, the canonical reader sources the value from
        // `field.value`, so writing the string there keeps the canonical doc
        // refresh consistent with the parsed tree.
        (field as { value: unknown }).value = field.type === "string" ? rawValue : displayValue;
        (field as { rawValue?: number | string }).rawValue = rawValue;
        this.refreshCanonicalDocument();
    }

    private setFieldValueById(fieldId: string, rawValue: number | string, displayValue: string): void {
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
