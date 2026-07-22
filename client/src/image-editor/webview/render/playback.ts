/**
 * Pure playback state machine for animation frame stepping. No timers or
 * clock reads live here - the caller (a requestAnimationFrame loop in the
 * Svelte component) measures elapsed time and drives `advance`, which keeps
 * the machine deterministic and unit-testable.
 */
export interface PlaybackState {
    playing: boolean;
    loop: boolean;
    frame: number;
    fps: number;
    frameCount: number;
}

export function createPlayback(opts: { frameCount: number; fps: number }): PlaybackState {
    return { playing: false, loop: false, frame: 0, fps: opts.fps, frameCount: opts.frameCount };
}

export function play(state: PlaybackState): PlaybackState {
    return { ...state, playing: true };
}

export function pause(state: PlaybackState): PlaybackState {
    return { ...state, playing: false };
}

export function stop(state: PlaybackState): PlaybackState {
    return { ...state, playing: false, frame: 0 };
}

export function toggleLoop(state: PlaybackState): PlaybackState {
    return { ...state, loop: !state.loop };
}

export function setFps(state: PlaybackState, fps: number): PlaybackState {
    return { ...state, fps };
}

function clampFrame(frame: number, frameCount: number): number {
    const maxFrame = Math.max(0, frameCount - 1);
    return Math.min(Math.max(frame, 0), maxFrame);
}

export function setFrame(state: PlaybackState, frame: number): PlaybackState {
    return { ...state, frame: clampFrame(frame, state.frameCount) };
}

/**
 * Advances by `floor(elapsedMs / (1000 / fps))` frames. Not playing, an empty
 * animation, or a non-positive fps all leave the state unchanged (division by
 * a non-positive fps is meaningless, so no steps are taken).
 */
export function advance(state: PlaybackState, elapsedMs: number): PlaybackState {
    if (!state.playing || state.frameCount <= 0 || state.fps <= 0) return state;

    const steps = Math.floor(elapsedMs / (1000 / state.fps));
    if (steps <= 0) return state;

    const next = state.frame + steps;
    if (next < state.frameCount) return { ...state, frame: next };
    if (state.loop) return { ...state, frame: next % state.frameCount };
    return { ...state, frame: state.frameCount - 1, playing: false };
}
