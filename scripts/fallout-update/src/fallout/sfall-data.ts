/**
 * Loads sfall functions.yml and hooks.yml, producing completion items
 * for the Fallout SSL language support.
 *
 * Shared helpers (litscal, cmpStr) are in utils/yaml-helpers.
 */

import fs from "node:fs";
import YAML from "yaml";
import { cmpStr, litscal } from "../../../utils/src/yaml-helpers.ts";
export { litscal } from "../../../utils/src/yaml-helpers.ts";
import { findFile } from "./header-defines.ts";
import type { FalloutCompletionItem, SfallCategory, SfallFunction } from "./types.ts";
import { validateArray, validateSfallCategory, validateSfallHook } from "./validate.ts";

const FUNCTIONS_YAML = "functions.yml";
const HOOKS_YAML = "hooks.yml";

/** Result of loading sfall functions */
export interface SfallFunctionsResult {
    readonly completionItems: readonly FalloutCompletionItem[];
}

/** Result of loading sfall hooks */
export interface SfallHooksResult {
    readonly completionItems: readonly FalloutCompletionItem[];
}

/**
 * Builds a completion item from an sfall function, merging category-level
 * documentation into the function's doc field.
 */
function buildCompletionItem(
    func: SfallCategory["items"] extends readonly (infer T)[] | undefined ? T : never,
    categoryDoc: string,
): FalloutCompletionItem {
    let doc = func.doc ?? "";
    if (categoryDoc !== "") {
        doc = doc === "" ? categoryDoc : `${doc}\n${categoryDoc}`;
    }

    const detail = signatureOf(func);
    const item: FalloutCompletionItem = {
        name: func.name,
        ...(detail !== "" ? { detail } : {}),
        ...(doc !== "" ? { doc: litscal(doc) } : {}),
        // `optional` is not carried: the signature already shows which arguments can be omitted.
        ...(func.args !== undefined
            ? {
                  args: func.args.map((a) => ({ name: a.name, type: a.type, doc: a.doc, default: a.default })),
                  type: func.type,
              }
            : {}),
        ...(func.deprecated !== undefined ? { deprecated: func.deprecated } : {}),
    };
    return item;
}

/**
 * The signature sfall's documentation generator writes for a function: its `detail` where it has one, else the
 * type, name and arguments, with a default after the argument it belongs to. A metarule function is called as
 * `sfall_funcN("metarule", ...)`, N the number of arguments passed, so it gets one line per count it accepts:
 * an omittable argument (`optional`, or one with a `default`) drops off the right along with those after it.
 */
function signatureOf(func: SfallFunction): string {
    if (func.detail !== undefined) return func.detail;
    const args = func.args ?? [];
    const params = args.map((a) =>
        a.default === undefined ? `${a.type} ${a.name}` : `${a.type} ${a.name} = ${a.default}`,
    );
    if (func.metarule !== undefined) {
        const required = args.filter((a) => a.optional !== true && a.default === undefined).length;
        const lines: string[] = [];
        for (let count = required; count <= params.length; count++) {
            const passed = [`"${func.metarule}"`, ...params.slice(0, count)];
            lines.push(`${func.type} sfall_func${count}(${passed.join(", ")})`);
        }
        return lines.join("\n");
    }
    if (func.args === undefined) return `${func.type} ${func.name}`;
    return `${func.type} ${func.name}(${params.join(", ")})`;
}

/**
 * Loads sfall functions.yml, validates the data, and produces completion items.
 * Categories and functions are sorted alphabetically to minimize diff noise.
 */
export function loadSfallFunctions(srcDir: string): SfallFunctionsResult {
    const functionsPath = findFile(srcDir, FUNCTIONS_YAML);
    if (functionsPath === undefined) {
        throw new Error(`${FUNCTIONS_YAML} not found in ${srcDir}`);
    }

    const content = fs.readFileSync(functionsPath, "utf8");
    const raw = YAML.parse(content) as unknown;
    const categories = validateArray(raw, validateSfallCategory, "functions.yml");

    const sortedCategories = [...categories].sort((a, b) => cmpStr(a.name, b.name));

    const completionItems: FalloutCompletionItem[] = [];

    for (const category of sortedCategories) {
        const categoryDoc = category.doc ?? "";

        if (category.items !== undefined) {
            const sortedFunctions = [...category.items].sort((a, b) => cmpStr(a.name, b.name));

            for (const func of sortedFunctions) {
                completionItems.push(buildCompletionItem(func, categoryDoc));
            }
        }
    }

    return { completionItems };
}

/**
 * Loads sfall hooks.yml, validates the data, and produces completion items.
 * Hooks are sorted alphabetically and prefixed with "HOOK_" in the output.
 */
export function loadSfallHooks(srcDir: string): SfallHooksResult {
    const hooksPath = findFile(srcDir, HOOKS_YAML);
    if (hooksPath === undefined) {
        throw new Error(`${HOOKS_YAML} not found in ${srcDir}`);
    }

    const content = fs.readFileSync(hooksPath, "utf8");
    const raw = YAML.parse(content) as unknown;
    const hooks = validateArray(raw, validateSfallHook, "hooks.yml");

    const sortedHooks = [...hooks].sort((a, b) => cmpStr(a.name, b.name));

    const completionItems: FalloutCompletionItem[] = [];

    for (const hook of sortedHooks) {
        const codename = `HOOK_${hook.name.toUpperCase()}`;
        completionItems.push({
            name: codename,
            doc: litscal(hook.doc),
        });
    }

    return { completionItems };
}
