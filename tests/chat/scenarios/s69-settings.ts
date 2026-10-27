// §69: settings by chat: the first day of the week and reading replies aloud; keys never.
import type { Scenario } from "../types.ts";
import { check } from "./helpers.ts";

export const scenarios: Scenario[] = [
  {
    name: "s69-week-start",
    fixture: "empty",
    turns: [
      {
        user: "start my week on Monday",
        expect: { toolCall: "settings", bucket: /settings/, reply: /Weeks now start on Monday/, data: (d) => check(d.weekStartsOn === 1, "week doesn't start on Monday") },
      },
    ],
  },
  {
    name: "s69-read-aloud",
    fixture: "empty",
    turns: [
      {
        user: "read your replies aloud",
        expect: { toolCall: "settings", reply: /read replies aloud on this device/, data: (d) => check(d.ttsEnabledByDevice?.["test-device"] === true, "read-aloud not saved") },
      },
    ],
  },
  {
    name: "s69-no-keys-by-chat",
    fixture: "empty",
    turns: [{ user: "change my API key in settings", expect: { reply: /Settings/ } }],
  },
];
