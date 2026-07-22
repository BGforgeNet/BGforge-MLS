<script lang="ts">
    import type { Bridge } from "../state/bridge";
    import type { AnimationView } from "../messages";
    import { DEFAULT_INIT_TIMEOUT_MS, installInitTimeout } from "../../../webview-utils";

    const { bridge }: { bridge: Bridge } = $props();

    let view = $state<AnimationView | null>(null);
    let errorMessage = $state<string | undefined>();
    // If the host never posts "init" (a dropped/failed open), surface it rather than sit on
    // "Loading..." forever. Timer mechanics shared with the binary/dialog editors' App.svelte
    // via installInitTimeout (webview-utils.ts).
    let initTimedOut = $state(false);

    $effect(() => {
        return bridge.onMessage((m) => {
            if (m.type === "init") {
                view = m.view;
                errorMessage = undefined;
            } else if (m.type === "error") {
                errorMessage = m.message;
            }
        });
    });

    $effect(() => {
        return installInitTimeout({
            ms: DEFAULT_INIT_TIMEOUT_MS,
            isResolved: () => view !== null,
            onTimeout: () => {
                initTimedOut = true;
            },
        });
    });
</script>

{#if errorMessage}
    <div class="error-state">
        <h2>Could not open file</h2>
        <p>{errorMessage}</p>
    </div>
{:else if !view}
    {#if initTimedOut}
        <div class="error-state">
            <h2>No response from the host</h2>
            <p>
                No response from the host within {DEFAULT_INIT_TIMEOUT_MS / 1000}s - the file did not open. Check the
                "BGforge MLS" output channel.
            </p>
        </div>
    {:else}
        <p class="placeholder">Loading...</p>
    {/if}
{:else}
    <!-- Smoke check only - the player and controls land in a later task. -->
    <p class="placeholder">{view.basename}: {view.sequences.length} sequences</p>
{/if}
