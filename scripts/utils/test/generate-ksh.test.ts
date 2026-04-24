/**
 * Tests for generate-ksh module: KDE KSyntaxHighlighting XML generation from YAML data.
 * Validates output structure and content, plus XSD validation via xmllint.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateKshXml } from "../src/generate-ksh.ts";

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

const XSD_URL = "https://raw.githubusercontent.com/KDE/syntax-highlighting/master/data/schema/language.xsd";

function hasXmllint(): boolean {
    try {
        execSync("xmllint --version", { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

describe("generateKshXml", () => {
    it("produces valid XML structure", () => {
        const xml = generateKshXml(SSL_LANG);
        expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
        expect(xml).toContain("<!DOCTYPE language>");
        expect(xml).toContain('<language name="Test SSL"');
        expect(xml).toContain('extensions="*.ssl;*.h"');
        expect(xml).toContain('section="Scripts"');
        expect(xml).toContain('kateversion="5.0"');
    });

    it("sets casesensitive correctly", () => {
        const sslXml = generateKshXml(SSL_LANG);
        const bafXml = generateKshXml(BAF_LANG);
        expect(sslXml).toContain('casesensitive="true"');
        expect(bafXml).toContain('casesensitive="false"');
    });

    it("includes keyword lists from YAML data", () => {
        const xml = generateKshXml(SSL_LANG);
        expect(xml).toContain('<list name="keywords">');
        expect(xml).toContain("<item>begin</item>");
        expect(xml).toContain("<item>procedure</item>");
        expect(xml).toContain('<list name="functions">');
        expect(xml).toContain("<item>critter_p_proc</item>");
    });

    it("includes BAF keywords", () => {
        const xml = generateKshXml(BAF_LANG);
        expect(xml).toContain("<item>IF</item>");
        expect(xml).toContain("<item>THEN</item>");
        expect(xml).toContain("<item>END</item>");
    });

    it("generates string contexts", () => {
        const sslXml = generateKshXml(SSL_LANG);
        // One string delimiter: "
        expect(sslXml).toContain('context="String1" char="&quot;"');
        expect(sslXml).toContain('<context name="String1"');

        const bafXml = generateKshXml(BAF_LANG);
        // Two string delimiters: ~ and "
        expect(bafXml).toContain('context="String1" char="~"');
        expect(bafXml).toContain('context="String2" char="&quot;"');
        expect(bafXml).toContain('<context name="String1"');
        expect(bafXml).toContain('<context name="String2"');
    });

    it("includes folding regions", () => {
        const xml = generateKshXml(SSL_LANG);
        expect(xml).toContain('String="begin" beginRegion="fold1"');
        expect(xml).toContain('String="end" endRegion="fold1"');
    });

    it("includes comment definitions", () => {
        const xml = generateKshXml(SSL_LANG);
        expect(xml).toContain('<comment name="singleLine" start="//"');
        expect(xml).toContain('<comment name="multiLine" start="/*" end="*/"');
        expect(xml).toContain('<context name="LineComment"');
        expect(xml).toContain('<context name="BlockComment"');
    });

    it("includes number detection rules", () => {
        const xml = generateKshXml(SSL_LANG);
        expect(xml).toContain("<HlCHex");
        expect(xml).toContain("<Float");
        expect(xml).toContain("<Int");
    });

    it("converts extensions to glob format", () => {
        const xml = generateKshXml({
            ...SSL_LANG,
            ext: "tp2 tpa tph tpp",
        });
        expect(xml).toContain('extensions="*.tp2;*.tpa;*.tph;*.tpp"');
    });

    it.skipIf(!hasXmllint())("validates against official KDE KSyntaxHighlighting XSD", () => {
        fs.mkdirSync("tmp", { recursive: true });
        const xsdPath = "tmp/language.xsd";
        const xmlPath = "tmp/test-ksh.xml";

        try {
            execSync(`curl -sfL -o "${xsdPath}" "${XSD_URL}"`, { stdio: "pipe" });

            for (const lang of [SSL_LANG, BAF_LANG]) {
                const xml = generateKshXml(lang);
                fs.writeFileSync(xmlPath, xml, "utf8");
                try {
                    execSync(`xmllint --schema "${xsdPath}" --noout "${xmlPath}"`, {
                        stdio: "pipe",
                    });
                } catch (e) {
                    const stderr = (e as { stderr?: Buffer }).stderr?.toString() ?? "";
                    throw new Error(`XSD validation failed for ${lang.name}:\n${stderr}`, { cause: e });
                }
            }
        } finally {
            fs.rmSync(xsdPath, { force: true });
            fs.rmSync(xmlPath, { force: true });
        }
    });

    it.skipIf(!hasXmllint())("validates static KSH files against official XSD", () => {
        const staticDir = "editors/kate";
        const staticFiles = fs.readdirSync(staticDir).filter((f) => f.endsWith(".ksh.xml"));
        expect(staticFiles.length).toBeGreaterThan(0);

        fs.mkdirSync("tmp", { recursive: true });
        const xsdPath = "tmp/language.xsd";

        try {
            execSync(`curl -sfL -o "${xsdPath}" "${XSD_URL}"`, { stdio: "pipe" });

            for (const file of staticFiles) {
                const xmlPath = path.join(staticDir, file);
                try {
                    execSync(`xmllint --schema "${xsdPath}" --noout "${xmlPath}"`, {
                        stdio: "pipe",
                    });
                } catch (e) {
                    const stderr = (e as { stderr?: Buffer }).stderr?.toString() ?? "";
                    throw new Error(`XSD validation failed for static file ${file}:\n${stderr}`, { cause: e });
                }
            }
        } finally {
            fs.rmSync(xsdPath, { force: true });
        }
    });
});
