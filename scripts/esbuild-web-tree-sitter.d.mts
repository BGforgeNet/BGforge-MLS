import type { Loader, Plugin } from "esbuild";

/** Extension-to-loader map that embeds the BAF tokenizer's `.wasm` (bytes) and `.scm` (text) in the bundle. */
export declare const webTreeSitterLoaders: Record<string, Loader>;

/** esbuild plugin stubbing web-tree-sitter's Node-only `fs/promises` / `module` imports for a browser build. */
export declare const stubNodeOnlyImports: Plugin;
