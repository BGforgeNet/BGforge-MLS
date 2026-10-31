import type { Loader } from "esbuild";

/** Extension-to-loader map that embeds the dialog highlighter's oniguruma `.wasm` (bytes) in the bundle. */
export declare const webTreeSitterLoaders: Record<string, Loader>;
