<script lang="ts">
    import { pause, play, setFrame, stop, toggleLoop, type PlaybackState } from "../render/playback";

    const { state, onChange }: { state: PlaybackState; onChange: (next: PlaybackState) => void } = $props();

    const lastFrame = $derived(Math.max(0, state.frameCount - 1));
</script>

<div class="playback-controls">
    <div class="playback-buttons" role="group" aria-label="Playback">
        <button type="button" onclick={() => onChange(play(state))} disabled={state.playing} title="Play" aria-label="Play">
            <span class="codicon codicon-play" aria-hidden="true"></span>
        </button>
        <button
            type="button"
            onclick={() => onChange(pause(state))}
            disabled={!state.playing}
            title="Pause"
            aria-label="Pause"
        >
            <span class="codicon codicon-debug-pause" aria-hidden="true"></span>
        </button>
        <button type="button" onclick={() => onChange(stop(state))} title="Stop" aria-label="Stop">
            <span class="codicon codicon-debug-stop" aria-hidden="true"></span>
        </button>
        <button
            type="button"
            class="playback-loop"
            class:active={state.loop}
            aria-pressed={state.loop}
            onclick={() => onChange(toggleLoop(state))}
            title="Loop"
            aria-label="Loop"
        >
            <span class="codicon codicon-sync" aria-hidden="true"></span>
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
            oninput={(e) => onChange(setFrame(state, Number(e.currentTarget.value)))}
            aria-label="Frame scrubber"
        />
        <span class="playback-value">{state.frame + 1} / {state.frameCount}</span>
    </label>
</div>
