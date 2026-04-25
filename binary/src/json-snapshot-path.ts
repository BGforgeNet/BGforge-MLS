export function getSnapshotPath(filePath: string): string {
    return `${filePath}.json`;
}

export function getOutputPathForJsonSnapshot(jsonPath: string, outputExtension: string): string {
    const preferredSuffix = `.${outputExtension}.json`;
    if (jsonPath.endsWith(preferredSuffix)) {
        return jsonPath.slice(0, -".json".length);
    }
    return jsonPath.replace(/\.json$/, `.${outputExtension}`);
}
