import { getContext, setContext } from "svelte";

/**
 * Browse-this-animation callback, provided by LayoutRenderer and consumed deep in the field tree - the same
 * arrangement as `open-resource-context`, and for the same reason: the affordance sits several components
 * below whatever holds the host bridge.
 *
 * Its own context rather than a second shape on the open-resource one: that callback takes a resref and an
 * extension and opens a FILE. An animation is a family of files named by an id, and the two would have to be
 * told apart at every call site if they shared a channel.
 */
export type OpenAnimationFn = (id: number) => void;

const OPEN_ANIMATION_KEY = Symbol("bin-open-animation");

export function provideOpenAnimation(fn: OpenAnimationFn): void {
    setContext(OPEN_ANIMATION_KEY, fn);
}

export function useOpenAnimation(): OpenAnimationFn | undefined {
    return getContext<OpenAnimationFn | undefined>(OPEN_ANIMATION_KEY);
}
