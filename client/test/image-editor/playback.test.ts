import { expect, test } from "vitest";
import {
    advance,
    createPlayback,
    pause,
    play,
    setFps,
    setFrame,
    stop,
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

test("setFps sets fps", () => {
    const state = createPlayback({ frameCount: 5, fps: 10 });
    expect(setFps(state, 24).fps).toBe(24);
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
