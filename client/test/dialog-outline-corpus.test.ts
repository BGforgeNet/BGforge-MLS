/**
 * Every real SSL dialog, through the outline's row projection.
 *
 * The unit tests build their inputs by hand, so they only exercise the shapes someone thought to write down.
 * This is the pass that sees what modders ship - and what it caught is the reason it exists: a node calling
 * one target from several `if`/`else if` branches emitted several rows carrying one deduped choice id, whose
 * keys collided. A repeat in the outline's keyed `{#each}` throws `each_key_duplicate` during mount, so the
 * whole dialog panel rendered as an error message and nothing else. Six dialogs in the Restoration Project
 * alone were unopenable that way, and no unit test or harness driver covered any of them.
 *
 * Row keys are the property under test rather than the rows themselves: uniqueness is what the renderer
 * actually requires, and it holds for every dialog whatever its shape.
 */
import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { parseDialog } from "../../server/src/dialog";
import { modelFromSSL } from "../../shared/dialog-model";
import { buildConversationTree } from "../src/dialog-editor/webview/conversation-tree";
import { flattenRows } from "../src/dialog-editor/webview/tree-rows";
import { REPO_ROOT } from "./repo-root";

const CORPUS = path.join(REPO_ROOT, "external/fallout");

function walk(dir: string, into: string[]): void {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, into);
        else if (entry.name.endsWith(".ssl")) into.push(full);
    }
}

const files: string[] = [];
if (fs.existsSync(CORPUS)) walk(CORPUS, files);
files.sort();

describe.skipIf(files.length === 0)("the outline over the real SSL corpus", () => {
    it("gives every row of every dialog its own key", async () => {
        const collisions: string[] = [];
        let dialogs = 0;
        for (const file of files) {
            const source = fs.readFileSync(file, "utf8");
            let rows;
            try {
                // eslint-disable-next-line no-await-in-loop -- one shared parser; the corpus is walked in order
                const model = modelFromSSL(await parseDialog(source));
                const conversation = model.roots[0];
                if (!conversation) continue; // a script with no dialogue - most of the corpus
                rows = flattenRows(
                    buildConversationTree(conversation, undefined, () => undefined).roots,
                    new Set(),
                    new Set(),
                );
            } catch {
                continue; // a parse failure is the SSL suites' subject, not this one's
            }
            dialogs += 1;
            const counts = new Map<string, number>();
            for (const row of rows) counts.set(row.key, (counts.get(row.key) ?? 0) + 1);
            const repeated = [...counts].filter(([, n]) => n > 1);
            if (repeated.length > 0) {
                const named = repeated.map(([key, n]) => `${key} x${n}`).join(", ");
                collisions.push(`${path.relative(CORPUS, file)}: ${named}`);
            }
        }

        // The count guards the guard: a projection that silently stopped producing rows would otherwise pass.
        expect(dialogs).toBeGreaterThan(100);
        expect(collisions).toEqual([]);
    });
});
