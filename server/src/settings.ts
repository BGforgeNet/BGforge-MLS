/**
 * Settings and configuration management.
 * Defines settings interfaces and loads project-specific configuration from YAML.
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";
import { conlog, errorMessage } from "./common";

export interface SSLsettings {
    compilePath: string;
    compileOptions: string;
    outputDirectory: string;
    headersDirectory: string;
    compileOnValidate: boolean;
}

export interface WeiDUsettings {
    path: string;
    gamePath: string;
}

export type ValidationMode = "manual" | "save" | "type" | "saveAndType";

export interface MLSsettings {
    falloutSSL: SSLsettings;
    weidu: WeiDUsettings;
    validate: ValidationMode;
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
    },
    weidu: { path: "weidu", gamePath: "" },
    validate: "saveAndType",
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
        weidu?: Partial<WeiDUsettings>;
    };

    return {
        falloutSSL: {
            ...defaultSettings.falloutSSL,
            ...raw.falloutSSL,
        },
        weidu: {
            ...defaultSettings.weidu,
            ...raw.weidu,
        },
        validate: raw.validate ?? defaultSettings.validate,
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
    } catch (e) {
        conlog(`Failed to load .bgforge.yml from ${dir}: ${errorMessage(e)}`, "warn");
    }
    return settings;
}
