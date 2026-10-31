/**
 * The text to show for a caught value: an `Error`'s own message, else the value's string form.
 *
 * `String(error)` on an `Error` puts the class name in front of the sentence the throw site wrote, so the
 * message is read directly. Pure and environment-free, so host, worker and webview bundles alike can import it.
 */
export function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
