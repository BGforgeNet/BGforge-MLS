/**
 * TypeScript Language Service Plugin for TD (.td) files.
 * - Injects td-runtime.d.ts so TD API functions are available without a tsconfig.
 * - Overrides compiler lib to exclude DOM types that clutter completions.
 * - Filters completions in .td files using a static blocklist of ES2020 lib names.
 * - Filters TD-specific completions out of non-.td files (e.g. .tbaf).
 *
 * Loaded by tsserver via contributes.typescriptServerPlugins in package.json
 * (VSCode) or via tsconfig.json plugins array (other editors).
 */

import type ts from "typescript";
import { filterEsLibCompletions, filterTdRuntimeCompletions } from "./filter-completions";
import { isTdFile, loadTdNames, overrideHost, resolveRuntimePath } from "./inject-runtime";

function init(modules: { typescript: typeof ts }): ts.server.PluginModule {
    // Memoized at init() scope (shared across create() calls) because the runtime
    // path depends on __dirname (the plugin's install location), not on the project.
    // All projects using this plugin share the same runtime file.
    let tdNames: ReadonlySet<string> | undefined;
    const runtime = resolveRuntimePath();

    /** TD runtime names, used to filter them OUT of non-.td file completions. */
    function getTdNames(): ReadonlySet<string> {
        if (tdNames === undefined) {
            tdNames = loadTdNames(runtime.path);
        }
        return tdNames;
    }

    function create(info: ts.server.PluginCreateInfo): ts.LanguageService {
        if (!runtime.exists) {
            return info.languageService;
        }

        overrideHost(info.languageServiceHost, runtime.path, modules.typescript);

        // Filter completions per file type:
        // - .td files: blocklist -- hide ES lib names, keep keywords/members/locals by kind
        // - non-.td files: blocklist -- remove TD runtime names that leak from shared projects
        const proxy = new Proxy(info.languageService, {
            get(target, prop, receiver) {
                if (prop === "getCompletionsAtPosition") {
                    return (fileName: string, position: number, options: ts.GetCompletionsAtPositionOptions) => {
                        const result: ts.WithMetadata<ts.CompletionInfo> | undefined = target.getCompletionsAtPosition(
                            fileName,
                            position,
                            options,
                        );
                        if (result === undefined) return result;

                        if (isTdFile(fileName)) {
                            return { ...result, entries: filterEsLibCompletions(result.entries) };
                        }

                        // In non-.td files, filter out TD runtime names
                        const names = getTdNames();
                        if (names.size === 0) return result;
                        return { ...result, entries: filterTdRuntimeCompletions(result.entries, names) };
                    };
                }
                return Reflect.get(target, prop, receiver);
            },
        });

        return proxy;
    }

    return { create };
}

export = init;
