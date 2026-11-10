// §82: a JSON backup by chat (export with a Download), and import pointing to Settings.
// The CSV of a period (§72) must stay a separate tool.
import type { Scenario } from "../types.ts";

export const scenarios: Scenario[] = [
  {
    name: "s82-backup-everything",
    fixture: "empty",
    turns: [{ user: "back up everything", expect: { toolCall: "backupData", reply: /^Your backup: / } }],
  },
  {
    name: "s82-backup-habits-without-history",
    fixture: "empty",
    turns: [{ user: "export my habits without the history", expect: { toolCall: "backupData", reply: /^Your backup: habits \(\d+\)/ } }],
  },
  {
    name: "s82-import-points-to-settings",
    fixture: "empty",
    turns: [{ user: "import my backup file", expect: { toolCall: "backupData", reply: /open Settings/ } }],
  },
  {
    name: "s82-period-stays-csv",
    fixture: "empty",
    turns: [{ user: "export last month as a spreadsheet", expect: { toolCall: "exportCsv" } }],
  },
];
