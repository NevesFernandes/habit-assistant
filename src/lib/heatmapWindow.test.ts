// §36 in Roadmap.md: the dates a habit's heatmap covers. Plain-assert style.
// Run: npm run test:heatmap
import assert from "node:assert/strict";
import { HEATMAP_MAX_DAYS, heatmapWindow } from "./habitStats.ts";
import { addDays } from "./recurrence.ts";
import type { Habit } from "../types/models.ts";

const TODAY = "2026-09-26";

const habit = (startDate: string, endDate?: string): Habit => ({
  kind: "habit",
  id: "read",
  name: "Read",
  categoryId: "study",
  priority: 1,
  startDate,
  endDate,
  recurrence: { type: "daily" },
  completionType: "yesno",
});

// A young habit starts at its own start date, not a year back.
assert.deepEqual(heatmapWindow(habit("2026-09-10"), TODAY), { from: "2026-09-10", to: TODAY });

// Started today: a one-day window.
assert.deepEqual(heatmapWindow(habit(TODAY), TODAY), { from: TODAY, to: TODAY });

// An old habit is capped at HEATMAP_MAX_DAYS back.
assert.deepEqual(heatmapWindow(habit("2020-01-01"), TODAY), { from: addDays(TODAY, -HEATMAP_MAX_DAYS), to: TODAY });

// Not started yet: nothing to draw.
assert.equal(heatmapWindow(habit("2026-10-03"), TODAY), null);

// Archived: ends on its last day, and the cap counts back from there.
assert.deepEqual(heatmapWindow(habit("2026-08-01", "2026-09-15"), TODAY), { from: "2026-08-01", to: "2026-09-15" });
assert.deepEqual(heatmapWindow(habit("2020-01-01", "2024-06-30"), TODAY), {
  from: addDays("2024-06-30", -HEATMAP_MAX_DAYS),
  to: "2024-06-30",
});

// An end date still ahead doesn't extend the window past today.
assert.deepEqual(heatmapWindow(habit("2026-09-10", "2026-12-31"), TODAY), { from: "2026-09-10", to: TODAY });

console.log("heatmapWindow.test.ts: all passed");
