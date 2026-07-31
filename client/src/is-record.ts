/** Narrowing guard for unknown message payloads. Pure and environment-free, so host and webview bundles alike can import it. */
export function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null;
}
