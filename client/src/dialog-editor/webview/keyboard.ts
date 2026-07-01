/**
 * Pure keyboard-shortcut predicates for the dialog webview. DialogGraph.svelte is otherwise DOM
 * wiring; the decision lives here so it is unit-tested without a Svelte runtime, the same split as
 * app-messages.ts. Kept event-shape-agnostic (a plain modifier record) so the test needs no real
 * KeyboardEvent.
 */

/**
 * True for the "save" chord: Ctrl+S, or Cmd+S on macOS, with Alt NOT held. The webview is a
 * WebviewPanel (not a CustomTextEditor), so VS Code's own Ctrl+S does not reach the underlying
 * document from here - the panel wires this to its own host save instead.
 */
export function isSaveShortcut(e: { ctrlKey: boolean; metaKey: boolean; altKey: boolean; key: string }): boolean {
    return (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s";
}
