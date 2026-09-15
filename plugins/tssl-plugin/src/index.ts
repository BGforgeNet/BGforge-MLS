/**
 * TypeScript Language Service Plugin for TSSL files.
 * - Suppresses TS6133 ("declared but never read") for engine procedure names.
 * - Injects hover documentation for engine procedures from YAML-generated data.
 *
 * Loaded by tsserver via contributes.typescriptServerPlugins in package.json
 * (VSCode) or via the TypeScript language server's plugin settings (other editors).
 *
 * Build dependency: engine-proc-docs.json must be generated before bundling.
 * This is done by generate-data.sh, which must run before build:tssl-plugin.
 */

import type ts from "typescript";
import { appendEngineProcDoc } from "./engine-proc-hover";
import { filterEngineProcedureDiagnostics } from "./filter-diagnostics";

const TSSL_EXTENSION = ".tssl";

function isTsslFile(fileName: string): boolean {
    return fileName.endsWith(TSSL_EXTENSION);
}

function init(_modules: { typescript: typeof ts }): ts.server.PluginModule {
    function create(info: ts.server.PluginCreateInfo): ts.LanguageService {
        const proxy = new Proxy(info.languageService, {
            get(target, prop, receiver) {
                if (prop === "getSemanticDiagnostics") {
                    return (fileName: string) => {
                        const diagnostics = target.getSemanticDiagnostics(fileName);
                        if (!isTsslFile(fileName)) {
                            return diagnostics;
                        }
                        return filterEngineProcedureDiagnostics(diagnostics);
                    };
                }
                if (prop === "getSuggestionDiagnostics") {
                    return (fileName: string) => {
                        const diagnostics = target.getSuggestionDiagnostics(fileName);
                        if (!isTsslFile(fileName)) {
                            return diagnostics;
                        }
                        return filterEngineProcedureDiagnostics(diagnostics);
                    };
                }
                if (prop === "getQuickInfoAtPosition") {
                    return (fileName: string, position: number) => {
                        const quickInfo = target.getQuickInfoAtPosition(fileName, position);
                        if (!isTsslFile(fileName)) {
                            return quickInfo;
                        }
                        return appendEngineProcDoc(quickInfo, quickInfo?.displayParts);
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
