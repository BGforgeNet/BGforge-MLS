/**
 * Settings and configuration management.
 * Defines settings interfaces and loads project-specific configuration from YAML.
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";
import { errorMessage } from "./diagnostics";
import { conlog } from "./logger";

export interface SSLsettings {
    compilePath: string;
    compileOptions: string;
    outputDirectory: string;
    headersDirectory: string;
    compileOnValidate: boolean;
    /** Which compiler runs when no external `compilePath` is configured. */
    compiler: "wasm" | "built-in";
}

export interface TSSLsettings {
    /**
     * Also write the readable `.ssl` beside the bytecode. Off by default: the compiler produces the
     * bytecode directly and nothing downstream needs the text.
     */
    emitSsl: boolean;
}

export interface WeiDUsettings {
    path: string;
    gamePath: string;
    /**
     * Codepage of the game's `dialog.tlk`, or "" to let the edition decide (UTF-8 for Enhanced Editions,
     * windows-1252 otherwise). Only classic non-Western installs need it: they record their encoding nowhere.
     */
    tlkEncoding: string;
    /** Which compiler produces BAF diagnostics. The external binary is the reference and stays the default. */
    compiler: "weidu" | "built-in";
}

type ValidationMode = "manual" | "save" | "type" | "saveAndType";

export interface MLSsettings {
    falloutSSL: SSLsettings;
    tssl: TSSLsettings;
    weidu: WeiDUsettings;
    validate: ValidationMode;
    // Tree-sitter parse-error diagnostics. Gated independently of `validate`
    // because the parse is in-memory and has none of the disk cost `validate`
    // exists to throttle - so it runs regardless of validation mode.
    diagnostics: boolean;
    debug: boolean;
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.

export const defaultSettings: MLSsettings = {
    falloutSSL: {
        compilePath: "",
        compileOptions: "-q -p -l -O2 -d -s -n",
        outputDirectory: "",
        headersDirectory: "",
        compileOnValidate: true,
        compiler: "wasm",
    },
    tssl: { emitSsl: false },
    weidu: { path: "weidu", gamePath: "", tlkEncoding: "", compiler: "weidu" },
    validate: "saveAndType",
    diagnostics: true,
    debug: false,
};

export function normalizeSettings(value: unknown): MLSsettings {
    // The `value` arrives from LSP `workspace/configuration` responses, which
    // VSCode types as `unknown`. We treat the runtime payload as a partial
    // settings object and rely on the spreads with `defaultSettings` below to
    // fill in any missing fields, so a malformed or partial response degrades
    // to defaults rather than throwing.
    const raw = (value ?? {}) as Partial<MLSsettings> & {
        falloutSSL?: Partial<SSLsettings>;
        tssl?: Partial<TSSLsettings>;
        weidu?: Partial<WeiDUsettings>;
    };

    return {
        falloutSSL: {
            ...defaultSettings.falloutSSL,
            ...raw.falloutSSL,
        },
        tssl: {
            ...defaultSettings.tssl,
            ...raw.tssl,
        },
        weidu: {
            ...defaultSettings.weidu,
            ...raw.weidu,
            // Only the recognised opt-in value switches compilers; anything else - unset, or an unrecognised
            // string from a stale config - falls back to the reference binary, same as falloutSSL.compiler's
            // "built-in" check downstream.
            compiler: raw.weidu?.compiler === "built-in" ? "built-in" : defaultSettings.weidu.compiler,
        },
        validate: raw.validate ?? defaultSettings.validate,
        diagnostics: raw.diagnostics ?? defaultSettings.diagnostics,
        debug: raw.debug ?? defaultSettings.debug,
    };
}

export function shouldValidateOnSave(mode: ValidationMode): boolean {
    return mode === "save" || mode === "saveAndType";
}

export function shouldValidateOnChange(mode: ValidationMode): boolean {
    return mode === "type" || mode === "saveAndType";
}

export interface ProjectTraSettings {
    directory: string;
    auto_tra: boolean;
}

export interface ProjectSettings {
    translation: ProjectTraSettings;
}

const defaultProjectSettings: ProjectSettings = {
    translation: {
        directory: "tra",
        auto_tra: true,
    },
};

/** get project settings from .bgforge.yml */
export function project(dir: string | undefined) {
    const settings = structuredClone(defaultProjectSettings);
    if (dir === undefined) {
        return settings;
    }
    try {
        const file = fs.readFileSync(path.join(dir, ".bgforge.yml"), "utf8");
        // yaml.parse() returns `any`. We narrow the structural shape with three
        // shallow `Record<string, unknown>` casts as we descend mls.translation,
        // then `typeof` guards on each leaf field before assignment. The casts
        // are scoped: `yaml` is an external API whose runtime shape isn't
        // recoverable through pure narrowing, so the recognised idiom is
        // structural cast at the boundary, value-checks at the use site.
        const yml = yaml.parse(file) as Record<string, unknown> | null;
        const yml_settings = yml?.mls as Record<string, unknown> | undefined;
        const translation = yml_settings?.translation as Record<string, unknown> | undefined;
        if (translation !== undefined) {
            if (typeof translation.directory === "string") {
                settings.translation.directory = translation.directory;
            }
            if (typeof translation.auto_tra === "boolean") {
                settings.translation.auto_tra = translation.auto_tra;
            }
        }
    } catch (error) {
        conlog(`Failed to load .bgforge.yml from ${dir}: ${errorMessage(error)}`, "warn");
    }
    return settings;
}
