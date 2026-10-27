// §67: notes on an item's day (src/lib/dayNotes.ts). Run: npm run test:dayNotes
import assert from "node:assert/strict";
import { noteOn, setDayNote } from "./dayNotes.ts";
import { deleteHabits, deleteSingleTasks } from "./dataStore.ts";
import { DEFAULT_CATEGORIES, type AppData } from "../types/models.ts";

const empty: AppData = { categories: DEFAULT_CATEGORIES, habits: [], recurringTasks: [], singleTasks: [], completionLog: [] };

let data = setDayNote(empty, "run", "2026-09-22", "  5 km, legs tired  ");
assert.equal(noteOn(data, "run", "2026-09-22"), "5 km, legs tired"); // trimmed
assert.equal(noteOn(data, "run", "2026-09-23"), undefined);
data = setDayNote(data, "run", "2026-09-22", "6 km");
assert.deepEqual(data.notes?.map((n) => n.text), ["6 km"]); // replaced, not added
data = setDayNote(data, "run", "2026-09-23", "rest");
data = setDayNote(data, "gym", "2026-09-22", "legs");
data = setDayNote(data, "run", "2026-09-23", "   ");
assert.equal(noteOn(data, "run", "2026-09-23"), undefined); // blank removes
// Deleting an item takes its notes; other items keep theirs.
assert.deepEqual(deleteHabits(data, ["run"]).notes?.map((n) => n.itemId), ["gym"]);
assert.deepEqual(deleteSingleTasks(data, ["gym"]).notes?.map((n) => n.itemId), ["run"]);
// A file without notes stays without the field when nothing is deleted from it.
assert.equal("notes" in deleteHabits(empty, ["x"]), false);

console.log("dayNotes: all assertions passed");
