/**
 * Regenerates `scenery-elevator.synthetic.pro`.
 *
 * Fallout 2's shipped data (and every vendored mod under `external/`) contains no scenery proto with
 * subtype 2 (elevator) - in-game elevators are driven by map scripts, not an elevator-subtype scenery
 * proto - so there is no real fixture to exercise the `scenery.elevator` layout variant's two fields
 * (`elevatorProperties.elevatorType` / `elevatorProperties.elevatorLevel`). This script manufactures one
 * the only honest way: it takes a real door proto, round-trips it through the codec's canonical JSON
 * snapshot, flips the scenery subtype 0 (door) -> 2 (elevator), and swaps the door section for an elevator
 * section. The bytes it emits parse cleanly back to `scenery.elevator` (the generator asserts this).
 *
 * Run: `pnpm exec tsx binary-editor/test/fixtures/generate-scenery-elevator.mts`
 */

import fs from "node:fs";
import path from "node:path";
import { formatAdapterRegistry, proParser } from "@bgforge/binary";

const here = import.meta.dirname;
const DOOR_FIXTURE = path.resolve(here, "../../../client/testFixture/proto/scenery/00000008.pro");
const OUT = path.join(here, "scenery-elevator.synthetic.pro");

const adapter = formatAdapterRegistry.get("pro");
if (!adapter?.createJsonSnapshot || !adapter.loadJsonSnapshot) throw new Error("pro adapter missing snapshot API");

const doorBytes = new Uint8Array(fs.readFileSync(DOOR_FIXTURE));
const snapshot = JSON.parse(adapter.createJsonSnapshot(proParser.parse(doorBytes)));
const sections = snapshot.document.sections as Record<string, unknown>;
(sections.sceneryProperties as { subType: number }).subType = 2; // 0 door -> 2 elevator
delete sections.doorProperties;
sections.elevatorProperties = { elevatorType: 0, elevatorLevel: 0 };

const { bytes } = adapter.loadJsonSnapshot(JSON.stringify(snapshot));
if (!bytes) throw new Error("loadJsonSnapshot returned no bytes");
const elevatorBytes = new Uint8Array(bytes);

// Fail loudly if the manufactured bytes do not parse back to the variant we are trying to cover.
const reparsed = proParser.parse(elevatorBytes);
if (reparsed.errors) throw new Error(`synthetic elevator has parse errors: ${reparsed.errors.join(", ")}`);
if (reparsed.variantId !== "scenery.elevator") throw new Error(`expected scenery.elevator, got ${reparsed.variantId}`);

fs.writeFileSync(OUT, elevatorBytes);
console.log(
    `wrote ${path.relative(process.cwd(), OUT)} (${elevatorBytes.length} bytes), variantId=${reparsed.variantId}`,
);
