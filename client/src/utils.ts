/**
 * Shared utility functions for client extension code.
 */

/**
 * Escape HTML special characters to prevent XSS.
 * Imported by extension host code (shared.ts, binaryEditor.ts) and by the
 * dialog-tree webview bundle (esbuild inlines the import).
 */
export function escapeHtml(text: string): string {
    return text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}
