/**
 * The compiler settings a project holding `.td` scripts is checked with, shared by the TD TypeScript plugin and
 * the fgtp CLI's type check so the editor and the command line report the same errors.
 */

/**
 * ES2020 and no DOM lib, whatever the project's tsconfig.json or the default lib says: DOM declarations would put
 * browser names (`RemotePlayback`, `XMLHttpRequestUpload`) in a dialog script's scope. The caller supplies its own
 * `ScriptTarget` enum, since the plugin runs against tsserver's TypeScript and the CLI against ts-morph's.
 */
export function tdProjectSettings<Target extends number>(scriptTarget: {
    readonly ES2020: Target;
}): {
    target: Target;
    lib: string[];
} {
    return { target: scriptTarget.ES2020, lib: ["lib.es2020.d.ts"] };
}
