import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import pkg from "../../package.json";
import { SCRIPT_EDITOR_VIEW_TYPE, SCRIPT_FORMATS } from "../src/script-view/formats";
import { REPO_ROOT } from "./repo-root";

/**
 * Every custom editor and every custom URI scheme is activated by the manifest.
 *
 * A custom editor whose `activationEvents` entry is missing does not fail, warn, or log: the extension is
 * simply never started, so the editor never registers and VS Code silently falls back to the plain text
 * editor. Nothing in a unit test can see it - the tests call the register function directly, and it works.
 * Only opening the file in a real editor shows it, which is how the `.bcs` view shipped broken once.
 *
 * Written per CLASS rather than per editor: the sibling manifest tests each pin one editor, which is exactly
 * the shape that lets the NEXT one be added without its event.
 */
const editors = pkg.contributes.customEditors as { viewType: string; selector: { filenamePattern: string }[] }[];
const events: readonly string[] = pkg.activationEvents;

/** Scheme constants the client declares, as `export const *SCHEME = "bgforge-..."`. */
function declaredSchemes(): { scheme: string; file: string }[] {
    const found: { scheme: string; file: string }[] = [];
    const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith(".ts")) {
                for (const m of fs.readFileSync(full, "utf8").matchAll(/export const \w*SCHEME = "(bgforge-[^"]+)"/g)) {
                    found.push({ scheme: m[1]!, file: path.relative(REPO_ROOT, full) });
                }
            }
        }
    };
    walk(path.join(REPO_ROOT, "client", "src"));
    return found;
}

describe("the extension manifest", () => {
    test("activates for every custom editor it declares", () => {
        const missing = editors
            .filter((editor) => !events.includes(`onCustomEditor:${editor.viewType}`))
            .map((editor) => editor.viewType);

        expect(missing).toEqual([]);
        // A guard over an empty list would pass while proving nothing.
        expect(editors.length).toBeGreaterThanOrEqual(4);
    });

    test("activates for every custom URI scheme the client serves", () => {
        const schemes = declaredSchemes();
        const missing = schemes
            .filter(({ scheme }) => !events.includes(`onFileSystem:${scheme}`))
            .map(({ scheme, file }) => `${scheme} (${file})`);

        expect(missing).toEqual([]);
        // Two: the game-resource bridge and the one every decompiled script is served on.
        expect(schemes.length).toBeGreaterThanOrEqual(2);
    });

    // The manifest cannot read the format registry - VS Code reads it before any code runs - so this is where
    // the two are held together. A format listed in the registry but not claimed here never reaches the view:
    // VS Code resolves the file to the plain text editor and nothing reports it.
    test("claims every compiled format the script registry serves", () => {
        const editor = editors.find((candidate) => candidate.viewType === SCRIPT_EDITOR_VIEW_TYPE);
        expect(editor, `${SCRIPT_EDITOR_VIEW_TYPE} is not in the manifest`).toBeDefined();

        const claimed = new Set(editor!.selector.map((one) => one.filenamePattern));
        const missing = SCRIPT_FORMATS.filter((format) => !claimed.has(`*.${format.ext}`)).map((f) => f.ext);

        expect(missing).toEqual([]);
    });

    // Every editor has to claim something, or it is dead weight that reads as wired.
    test("gives every custom editor at least one file pattern", () => {
        for (const editor of editors) {
            expect(editor.selector.length, `${editor.viewType} claims no file pattern`).toBeGreaterThan(0);
        }
    });
});
