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

// Playback rate for sources without a usable one: FRM headers can store fps 0, and imported
// animations may carry none. Matches the BAM engine rate the parser resolves.
export const DEFAULT_PLAYBACK_FPS = 15;

export function createPlayback(opts: { frameCount: number; fps: number }): PlaybackState {
    // Resolved once here so the transport controls and tick never see a sub-1 fps; the source's
    // stored fps metadata is untouched (a 0-fps FRM still shows and saves 0).
    const fps = opts.fps >= 1 ? opts.fps : DEFAULT_PLAYBACK_FPS;
    return { playing: false, loop: false, frame: 0, fps, frameCount: opts.frameCount };
}

export function play(state: PlaybackState): PlaybackState {
    // Restart from the top when Play is pressed on a finished, non-looping playthrough (sitting on the
    // last frame): otherwise the next tick immediately re-hits the end and stops, so Play does nothing.
    const atEnd = state.frame >= state.frameCount - 1;
    return { ...state, playing: true, frame: atEnd ? 0 : state.frame };
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

export function msPerFrame(fps: number): number {
    return 1000 / fps;
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

    const steps = Math.floor(elapsedMs / msPerFrame(state.fps));
    if (steps <= 0) return state;

    const next = state.frame + steps;
    if (next < state.frameCount) return { ...state, frame: next };
    if (state.loop) return { ...state, frame: next % state.frameCount };
    return { ...state, frame: state.frameCount - 1, playing: false };
}

/**
 * rAF-friendly stepping. A requestAnimationFrame loop fires ~every 16ms; at any fps whose frame
 * interval exceeds that (fps < ~62, i.e. every realistic value), flooring each 16ms delta to whole
 * frames yields 0 and playback never advances - unless the unconsumed remainder is carried forward.
 * `tick` returns the advanced state plus the leftover ms not yet consumed by a whole frame; the caller
 * feeds `leftover + delta` back in next frame so time accumulates instead of being discarded per tick.
 */
export function tick(state: PlaybackState, elapsedMs: number): { state: PlaybackState; leftoverMs: number } {
    if (!state.playing || state.frameCount <= 0 || state.fps <= 0) return { state, leftoverMs: 0 };
    const per = msPerFrame(state.fps);
    const steps = Math.floor(elapsedMs / per);
    if (steps <= 0) return { state, leftoverMs: elapsedMs };
    return { state: advance(state, elapsedMs), leftoverMs: elapsedMs - steps * per };
}
