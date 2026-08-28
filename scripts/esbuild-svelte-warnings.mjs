/**
 * Shared esbuild-svelte warning filter, used by every build that compiles Svelte components.
 *
 * Svelte libraries ship uncompiled .svelte sources, so compiling them here inherits the Svelte compiler's
 * lints about THEIR internal patterns (bits-ui alone emits dozens of state_referenced_locally warnings) -
 * unactionable noise that would bury a genuine warning from our own components. Drop third-party warnings;
 * ours stay visible.
 */
export const dropThirdPartyWarnings = (warning) => !warning.filename?.includes("node_modules");
