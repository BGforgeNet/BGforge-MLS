import type { Plugin } from "esbuild";

/** The virtual specifier the dialog editor imports elkjs's worker source under. */
export declare const ELK_WORKER_SOURCE_SPECIFIER: string;

/** esbuild plugin resolving that specifier to elkjs's worker script and loading it as embedded text. */
export declare const elkWorkerAsText: Plugin;
