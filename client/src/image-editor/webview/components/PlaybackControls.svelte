<script lang="ts">
    import { pause, play, setFrame, stop, toggleLoop, type PlaybackState } from "../render/playback";
    import Icon from "../../../webview-ui/Icon.svelte";

    const { state, onChange }: { state: PlaybackState; onChange: (next: PlaybackState) => void } = $props();

    const lastFrame = $derived(Math.max(0, state.frameCount - 1));
    // Playback needs at least 2 frames; a zero/missing source fps no longer disables the transport -
    // createPlayback resolves it to DEFAULT_PLAYBACK_FPS.
    const canPlay = $derived(state.frameCount > 1);
    const disabledReason = "Only one frame - nothing to play";
</script>

<div class="playback-controls">
    <div class="playback-buttons" role="group" aria-label="Playback">
        <button
            type="button"
            onclick={() => onChange(play(state))}
            disabled={state.playing || !canPlay}
            title={canPlay ? "Play" : disabledReason}
            aria-label="Play"
        >
            <Icon name="play" />
        </button>
        <button
            type="button"
            onclick={() => onChange(pause(state))}
            disabled={!state.playing || !canPlay}
            title={canPlay ? "Pause" : disabledReason}
            aria-label="Pause"
        >
            <Icon name="debug-pause" />
        </button>
        <button
            type="button"
            onclick={() => onChange(stop(state))}
            disabled={!canPlay}
            title={canPlay ? "Stop" : disabledReason}
            aria-label="Stop"
        >
            <Icon name="debug-stop" />
        </button>
        <button
            type="button"
            class="playback-loop"
            class:active={state.loop}
            aria-pressed={state.loop}
            onclick={() => onChange(toggleLoop(state))}
            disabled={!canPlay}
            title={canPlay ? "Loop" : disabledReason}
            aria-label="Loop"
        >
            <Icon name="sync" />
        </button>
    </div>
    <label class="playback-field">
        <span class="playback-label">Frame</span>
        <input
            type="range"
            min="0"
            max={lastFrame}
            step="1"
            value={state.frame}
            disabled={state.frameCount <= 1}
            oninput={(e) => onChange(setFrame(state, Number(e.currentTarget.value)))}
            aria-label="Frame scrubber"
        />
        <!-- Frames count from one for the reader, so an empty transport reads "0 / 0" rather than the
             "1 / 0" that counting a frame nothing holds would produce. -->
        <span class="playback-value">{state.frameCount === 0 ? 0 : state.frame + 1} / {state.frameCount}</span>
    </label>
</div>
