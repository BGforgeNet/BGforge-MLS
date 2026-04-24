/**
 * Tests for generate-geany module: Geany filetype .conf generation from YAML data.
 * Validates output structure and content.
 */

import { describe, expect, it } from "vitest";
import { generateGeanyConf } from "../src/generate-geany.ts";

const SSL_LANG = {
    name: "test-ssl",
    displayName: "Test SSL",
    ext: "ssl h",
    yamlFiles: ["server/data/fallout-ssl-base.yml"],
    caseIgnored: false,
    stringDelimiters: [['"', '"']] as const,
    foldingPairs: [["begin", "end"]] as const,
};

const BAF_LANG = {
    name: "test-baf",
    displayName: "Test BAF",
    ext: "baf",
    yamlFiles: ["server/data/weidu-baf-base.yml"],
    caseIgnored: true,
    stringDelimiters: [
        ["~", "~"],
        ['"', '"'],
    ] as const,
    foldingPairs: [["IF", "END"]] as const,
};

describe("generateGeanyConf", () => {
    it("produces valid conf structure", () => {
        const conf = generateGeanyConf(SSL_LANG);
        expect(conf).toContain("[styling=C]");
        expect(conf).toContain("[keywords]");
        expect(conf).toContain("[settings]");
        expect(conf).toContain("lexer_filetype=C");
        expect(conf).toContain("extension=ssl;h");
    });

    it("includes comment settings", () => {
        const conf = generateGeanyConf(SSL_LANG);
        expect(conf).toContain("comment_single=//");
        expect(conf).toContain("comment_open=/*");
        expect(conf).toContain("comment_close=*/");
    });

    it("includes keywords from YAML data", () => {
        const conf = generateGeanyConf(SSL_LANG);
        expect(conf).toContain("primary=");
        expect(conf).toMatch(/primary=.*\bbegin\b/);
        expect(conf).toMatch(/primary=.*\bprocedure\b/);
    });

    it("includes functions as secondary keywords", () => {
        const conf = generateGeanyConf(SSL_LANG);
        expect(conf).toContain("secondary=");
        expect(conf).toMatch(/secondary=.*\bcritter_p_proc\b/);
    });

    it("includes constants as doccomment keywords", () => {
        const conf = generateGeanyConf(SSL_LANG);
        expect(conf).toContain("doccomment=");
    });

    it("includes BAF keywords", () => {
        const conf = generateGeanyConf(BAF_LANG);
        expect(conf).toMatch(/primary=.*\bIF\b/);
        expect(conf).toMatch(/primary=.*\bTHEN\b/);
        expect(conf).toMatch(/primary=.*\bEND\b/);
    });

    it("converts extensions to semicolon-separated list", () => {
        const conf = generateGeanyConf({
            ...SSL_LANG,
            ext: "tp2 tpa tph tpp",
        });
        expect(conf).toContain("extension=tp2;tpa;tph;tpp");
    });

    it("includes indentation section", () => {
        const conf = generateGeanyConf(SSL_LANG);
        expect(conf).toContain("[indentation]");
        expect(conf).toContain("width=4");
    });

    it("includes display name in header comment", () => {
        const conf = generateGeanyConf(SSL_LANG);
        expect(conf).toContain("# Geany filetype definition for Test SSL.");
    });
});
