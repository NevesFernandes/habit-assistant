// §72: export a period as a CSV; with no period named, the app asks which one.
import type { Scenario } from "../types.ts";

export const scenarios: Scenario[] = [
  {
    name: "s72-export-asks-period",
    fixture: "empty",
    turns: [{ user: "export my data as a spreadsheet", expect: { toolCall: "exportCsv", reply: /Which period should I export/ } }],
  },
  {
    name: "s72-export-last-month",
    fixture: "empty",
    turns: [{ user: "export last month as a spreadsheet", expect: { toolCall: "exportCsv", reply: /(Your spreadsheet for|nothing to export)/ } }],
  },
];
