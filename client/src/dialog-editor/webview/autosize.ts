/**
 * Svelte action: grow a `<textarea>` to fit its content so nothing hides behind an inner scrollbar.
 *
 * Pass the current display VALUE as the action parameter so a reactive value change (e.g. selecting a
 * different option) re-fits, not just keystrokes:
 *
 *     <textarea use:autosize={value} value={value} oninput={...}></textarea>
 *
 * TIMING RULE (why `update` defers to a microtask): an action or effect that MEASURES laid-out DOM
 * (`scrollHeight`, `getBoundingClientRect`, `offsetWidth`, ...) after a reactive change must never assume the
 * element already holds the new value. Svelte can run the action's `update` BEFORE it writes the bound `value`
 * to the element, so a synchronous measure reads the STALE content and the size lags one change behind (a
 * one-line value rendering in a two-line box with an empty line). Deferring the fit to a microtask runs it after
 * the DOM value has settled. The general form: defer any DOM-reading action/effect to a microtask/tick, or
 * derive the measurement from the reactive value - do not measure the DOM synchronously at update time.
 */
export function autosize(el: HTMLTextAreaElement): { update: () => void; destroy: () => void } {
    const fit = (): void => {
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    el.addEventListener("input", fit);
    return { update: () => queueMicrotask(fit), destroy: () => el.removeEventListener("input", fit) };
}
