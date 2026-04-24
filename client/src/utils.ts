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
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
