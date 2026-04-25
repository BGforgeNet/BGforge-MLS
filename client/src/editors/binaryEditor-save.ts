import * as vscode from "vscode";
import { type ParseResult, createBinaryJsonSnapshot, getSnapshotPath } from "@bgforge/binary";

const AUTO_DUMP_JSON_SETTING = "binaryEditor.autoDumpJson";

export async function saveBinaryDocumentArtifacts(
    documentUri: vscode.Uri,
    saveUri: vscode.Uri,
    bytes: Uint8Array,
    parseResult: ParseResult,
): Promise<void> {
    await vscode.workspace.fs.writeFile(saveUri, bytes);

    if (!shouldAutoDumpJsonOnSave(documentUri)) {
        return;
    }

    await writeBinaryJsonSnapshot(saveUri, parseResult);
}

export async function writeBinaryJsonSnapshot(uri: vscode.Uri, parseResult: ParseResult): Promise<vscode.Uri> {
    const jsonUri = uri.with({ path: getSnapshotPath(uri.path) });
    const json = createBinaryJsonSnapshot(parseResult);
    await vscode.workspace.fs.writeFile(jsonUri, Buffer.from(json, "utf8"));
    return jsonUri;
}

function shouldAutoDumpJsonOnSave(resource: vscode.Uri): boolean {
    return vscode.workspace.getConfiguration("bgforge", resource).get<boolean>(AUTO_DUMP_JSON_SETTING, false);
}
