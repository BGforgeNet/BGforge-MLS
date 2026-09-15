/**
 * The command that runs a TypeScript entry point in a child Node: this process's own runtime with tsx's loader.
 *
 * Not `pnpm exec tsx`: the package-manager launcher's own startup outweighs a short script's whole run, and
 * the CLI tests pay it once per case. `--import tsx` resolves from the child's cwd, so run it from the repo
 * root, where tsx is a dependency.
 */
export function tsxCommand(script: string, args: readonly string[] = []): { file: string; args: string[] } {
    return { file: process.execPath, args: ["--import", "tsx", script, ...args] };
}
