import { conlog } from "../logger";
import { showError } from "../user-messages";

/**
 * Catch handler for fire-and-forget `compile()` calls (onExecuteCommand and the
 * save/validate document-lifecycle paths). `compile()` reports parse diagnostics
 * itself; this only fires on an unexpected exception (I/O, spawn, a programming
 * error) that would otherwise vanish.
 *
 * Always logged at error level so it appears in the output channel. An
 * interactive invocation (the explicit compile command) also surfaces a toast -
 * the user asked to compile and would otherwise see nothing. Non-interactive
 * save/validate failures stay log-only to avoid a toast on every save/keystroke.
 */
export function handleCompileError(err: unknown, interactive: boolean): void {
    const message = err instanceof Error ? err.message : String(err);
    conlog(`Compilation error: ${message}`, "error");
    if (interactive) {
        showError(`Compilation failed: ${message}`);
    }
}
