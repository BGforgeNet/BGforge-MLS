import { expect, test } from "vitest";
import {
    advance,
    createPlayback,
    msPerFrame,
    pause,
    play,
    setFrame,
    stop,
    tick,
    toggleLoop,
    type PlaybackState,
} from "../../src/image-editor/webview/render/playback";

test("createPlayback returns a stopped state at frame 0", () => {
    const state = createPlayback({ frameCount: 5, fps: 10 });
    expect(state).toEqual({ playing: false, loop: false, frame: 0, fps: 10, frameCount: 5 });
});

test("play sets playing true without mutating the input", () => {
    const state = createPlayback({ frameCount: 5, fps: 10 });
    const result = play(state);
    expect(result).toEqual({ playing: true, loop: false, frame: 0, fps: 10, frameCount: 5 });
    expect(state.playing).toBe(false);
});

test("play from the last frame of a finished playthrough restarts at frame 0", () => {
    // The natural end-of-playback state: stopped on the last frame. Play must rewind, or the next tick
    // immediately re-hits the end and stops (the "second play does nothing" bug).
    const state: PlaybackState = { playing: false, loop: false, frame: 4, fps: 10, frameCount: 5 };
    const result = play(state);
    expect(result.frame).toBe(0);
    expect(result.playing).toBe(true);
});

test("play resumes from the current frame when paused mid-way (no rewind)", () => {
    const state: PlaybackState = { playing: false, loop: false, frame: 2, fps: 10, frameCount: 5 };
    expect(play(state).frame).toBe(2);
});

test("pause sets playing false", () => {
    const state = play(createPlayback({ frameCount: 5, fps: 10 }));
    expect(pause(state).playing).toBe(false);
});

test("stop resets frame to 0 and playing to false", () => {
    const state: PlaybackState = { playing: true, loop: true, frame: 3, fps: 10, frameCount: 5 };
    expect(stop(state)).toEqual({ playing: false, loop: true, frame: 0, fps: 10, frameCount: 5 });
});

test("toggleLoop flips loop", () => {
    const state = createPlayback({ frameCount: 5, fps: 10 });
    expect(toggleLoop(state).loop).toBe(true);
    expect(toggleLoop(toggleLoop(state)).loop).toBe(false);
});

test("msPerFrame converts fps to a frame interval", () => {
    expect(msPerFrame(10)).toBe(100);
    expect(msPerFrame(25)).toBe(40);
});

test("setFrame clamps to [0, frameCount - 1]", () => {
    const state = createPlayback({ frameCount: 5, fps: 10 });
    expect(setFrame(state, 10).frame).toBe(4);
    expect(setFrame(state, -3).frame).toBe(0);
    expect(setFrame(state, 2).frame).toBe(2);
});

test("setFrame clamps to 0 when frameCount is 0", () => {
    const state = createPlayback({ frameCount: 0, fps: 10 });
    expect(setFrame(state, 10).frame).toBe(0);
});

test("advance steps exactly one frame after 1000/fps ms", () => {
    const state: PlaybackState = { playing: true, loop: false, frame: 0, fps: 10, frameCount: 5 };
    expect(advance(state, 100).frame).toBe(1);
});

test("advance takes a multi-frame jump for a large elapsed", () => {
    const state: PlaybackState = { playing: true, loop: false, frame: 0, fps: 10, frameCount: 5 };
    expect(advance(state, 350).frame).toBe(3);
});

test("advance wraps to the start when looping past the last frame", () => {
    const state: PlaybackState = { playing: true, loop: true, frame: 3, fps: 10, frameCount: 5 };
    const result = advance(state, 300);
    expect(result.frame).toBe(1);
    expect(result.playing).toBe(true);
});

test("advance clamps to the last frame and stops when not looping", () => {
    const state: PlaybackState = { playing: true, loop: false, frame: 3, fps: 10, frameCount: 5 };
    const result = advance(state, 300);
    expect(result.frame).toBe(4);
    expect(result.playing).toBe(false);
});

test("advance on a paused state is a no-op", () => {
    const state: PlaybackState = { playing: false, loop: false, frame: 2, fps: 10, frameCount: 5 };
    expect(advance(state, 500)).toBe(state);
});

test("advance guards against frameCount <= 0", () => {
    const state: PlaybackState = { playing: true, loop: false, frame: 0, fps: 10, frameCount: 0 };
    expect(advance(state, 1000)).toBe(state);
});

test("advance guards against fps <= 0", () => {
    const state: PlaybackState = { playing: true, loop: false, frame: 0, fps: 0, frameCount: 5 };
    expect(advance(state, 1000)).toBe(state);
});

test("advance with an elapsed under one frame interval is a no-op", () => {
    const state: PlaybackState = { playing: true, loop: false, frame: 0, fps: 10, frameCount: 5 };
    expect(advance(state, 50)).toBe(state);
});

test("tick on a paused state carries no leftover", () => {
    const state = createPlayback({ frameCount: 5, fps: 10 });
    expect(tick(state, 200)).toEqual({ state, leftoverMs: 0 });
});

test("tick under one frame interval takes no step and carries the whole elapsed forward", () => {
    const state: PlaybackState = { playing: true, loop: false, frame: 0, fps: 10, frameCount: 5 };
    const result = tick(state, 16);
    expect(result.state.frame).toBe(0);
    expect(result.leftoverMs).toBe(16);
});

test("tick accumulated across sub-frame deltas eventually steps - the Play-doesn't-advance regression", () => {
    // Six ~16ms rAF deltas = 96ms < one 100ms frame each; discarding the remainder (the old bug) would
    // never advance. Carrying leftover forward, the 7th delta crosses 100ms and steps one frame.
    let state: PlaybackState = { playing: true, loop: false, frame: 0, fps: 10, frameCount: 5 };
    let leftover = 0;
    for (let i = 0; i < 6; i++) {
        const r = tick(state, leftover + 16);
        state = r.state;
        leftover = r.leftoverMs;
    }
    expect(state.frame).toBe(0); // 96ms accumulated, still under 100
    const r = tick(state, leftover + 16); // 112ms total -> one step, 12ms remainder
    expect(r.state.frame).toBe(1);
    expect(r.leftoverMs).toBe(12);
});

test("tick keeps the sub-frame remainder after a whole-frame step", () => {
    const state: PlaybackState = { playing: true, loop: false, frame: 0, fps: 10, frameCount: 5 };
    const result = tick(state, 250); // two 100ms frames + 50ms
    expect(result.state.frame).toBe(2);
    expect(result.leftoverMs).toBe(50);
});
