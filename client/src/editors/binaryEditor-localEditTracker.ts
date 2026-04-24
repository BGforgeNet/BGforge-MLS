import type { FieldEdit } from "./binaryEditor-document";

export class BinaryEditorLocalEditTracker {
    private lastEdit: FieldEdit | undefined;

    record(edit: FieldEdit): void {
        this.lastEdit = edit;
    }

    clear(): void {
        this.lastEdit = undefined;
    }

    shouldUndo(fieldId: string, newRawValue: number): boolean {
        return (
            this.lastEdit?.incrementalSafe === true &&
            this.lastEdit.fieldId === fieldId &&
            this.lastEdit.oldRawValue === newRawValue
        );
    }
}
