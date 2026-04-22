/**
 * Tests for generate-udl module: Notepad++ UDL XML generation from YAML data.
 * Validates output structure and content, plus XSD validation via xmllint.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateUdlXml } from "../src/generate-udl.ts";

const SSL_LANG = {
    name: "test-ssl",
    displayName: "Test SSL",
    ext: "ssl h",
    yamlFiles: ["server/data/fallout-ssl-base.yml"],
    caseIgnored: false,
    stringDelimiters: [["\"", "\""]] as const,
    foldingPairs: [["begin", "end"]] as const,
};

const BAF_LANG = {
    name: "test-baf",
    displayName: "Test BAF",
    ext: "baf",
    yamlFiles: ["server/data/weidu-baf-base.yml"],
    caseIgnored: true,
    stringDelimiters: [["~", "~"], ["\"", "\""]] as const,
    foldingPairs: [["IF", "END"]] as const,
};

const XSD_URL = "https://raw.githubusercontent.com/notepad-plus-plus/userDefinedLanguages/master/.validators/userDefineLangs.xsd";

function hasXmllint(): boolean {
    try {
        execSync("xmllint --version", { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

describe("generateUdlXml", () => {
    it("produces valid XML structure", () => {
        const xml = generateUdlXml(SSL_LANG);
        expect(xml).toContain('<?xml version="1.0" encoding="UTF-8" ?>');
        expect(xml).toContain("<NotepadPlus>");
        expect(xml).toContain("</NotepadPlus>");
        expect(xml).toContain('name="test-ssl"');
        expect(xml).toContain('ext="ssl h"');
        expect(xml).toContain('udlVersion="2.1"');
    });

    it("sets caseIgnored correctly", () => {
        const sslXml = generateUdlXml(SSL_LANG);
        const bafXml = generateUdlXml(BAF_LANG);
        expect(sslXml).toContain('caseIgnored="no"');
        expect(bafXml).toContain('caseIgnored="yes"');
    });

    it("includes comment definitions", () => {
        const xml = generateUdlXml(SSL_LANG);
        expect(xml).toContain("00// 01 02 03/* 04*/");
    });

    it("includes keywords from YAML data", () => {
        const xml = generateUdlXml(SSL_LANG);
        // Keywords1 = type 14 (keywords)
        expect(xml).toContain(">begin ");
        expect(xml).toContain(" procedure ");
        // Keywords2 = type 3 (functions)
        expect(xml).toContain("critter_p_proc");
    });

    it("includes BAF keywords", () => {
        const xml = generateUdlXml(BAF_LANG);
        expect(xml).toContain("IF");
        expect(xml).toContain("THEN");
        expect(xml).toContain("END");
    });

    it("encodes string delimiters", () => {
        const sslXml = generateUdlXml(SSL_LANG);
        // Single delimiter: " in slots 00-02
        expect(sslXml).toContain('00&quot; 01 02&quot;');

        const bafXml = generateUdlXml(BAF_LANG);
        // Two delimiters: ~ in 00-02, " in 03-05
        expect(bafXml).toContain("00~ 01 02~");
        expect(bafXml).toContain("03&quot; 04 05&quot;");
    });

    it("includes folding pairs", () => {
        const sslXml = generateUdlXml(SSL_LANG);
        expect(sslXml).toContain('<Keywords name="Folders in code1, open">begin</Keywords>');
        expect(sslXml).toContain('<Keywords name="Folders in code1, close">end</Keywords>');

        const bafXml = generateUdlXml(BAF_LANG);
        expect(bafXml).toContain('<Keywords name="Folders in code1, open">IF</Keywords>');
        expect(bafXml).toContain('<Keywords name="Folders in code1, close">END</Keywords>');
    });

    it("includes hex number prefix", () => {
        const xml = generateUdlXml(SSL_LANG);
        expect(xml).toContain('name="Numbers, prefix2">0x 0X</Keywords>');
    });

    it("includes operator definitions", () => {
        const xml = generateUdlXml(SSL_LANG);
        expect(xml).toContain("&amp;");
        expect(xml).toContain("&lt;");
        expect(xml).toContain("&gt;");
    });

    it.skipIf(!hasXmllint())("validates against official Notepad++ UDL XSD", () => {
        fs.mkdirSync("tmp", { recursive: true });
        const xsdPath = "tmp/userDefineLangs.xsd";
        const xmlPath = "tmp/test-udl.xml";

        try {
            // Download XSD once (xmllint can't fetch HTTPS directly)
            execSync(`curl -sfL -o "${xsdPath}" "${XSD_URL}"`, { stdio: "pipe" });

            for (const lang of [SSL_LANG, BAF_LANG]) {
                const xml = generateUdlXml(lang);
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

    it.skipIf(!hasXmllint())("validates static UDL files against official XSD", () => {
        const staticDir = "editors/notepadpp";
        const staticFiles = fs.readdirSync(staticDir).filter((f) => f.endsWith(".udl.xml"));
        expect(staticFiles.length).toBeGreaterThan(0);

        fs.mkdirSync("tmp", { recursive: true });
        const xsdPath = "tmp/userDefineLangs.xsd";

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
