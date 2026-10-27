// §69: settings by chat (settingsByChat.ts), through the app's chat engine with a fake model.
// The connector's side is in src/mcp/manageTools.test.ts. Run: npm run test:settingsByChat
import assert from "node:assert/strict";
import { ChatSession } from "./chatEngine.ts";
import { readAloudEverywhere, readAloudOn, withReadAloudEverywhere, withReadAloudHere } from "./settingsByChat.ts";
import { DEFAULT_CATEGORIES, weekStartOf, type AppData } from "../types/models.ts";
import type { AgentToolCall } from "./agentClient.ts";

const base: AppData = { categories: DEFAULT_CATEGORIES, habits: [], recurringTasks: [], singleTasks: [], completionLog: [] };

// One device's value: its own, else the "everywhere" one, else off.
assert.equal(readAloudOn(base, "phone"), false);
const here = withReadAloudHere(base, "phone", true);
assert.deepEqual([readAloudOn(here, "phone"), readAloudOn(here, "laptop")], [true, false]);
assert.equal(readAloudEverywhere(here), "on");
const mixed = withReadAloudHere(here, "laptop", false);
assert.equal(readAloudEverywhere(mixed), "on on some devices, off on others");
const everywhere = withReadAloudEverywhere(mixed, true);
assert.deepEqual(everywhere.ttsEnabledByDevice, { phone: true, laptop: true });
assert.equal(readAloudOn(everywhere, "tablet"), true); // a device added later follows it
assert.equal(readAloudEverywhere(withReadAloudEverywhere(base, false)), "off");
assert.equal(readAloudEverywhere(base), "off");

// The engine: the model's settings call, run against a saved file and this device's toggle.
async function run(input: Record<string, unknown>, options: { data?: AppData; reading?: boolean; supported?: boolean } = {}) {
  let data = options.data ?? base;
  let reading = options.reading ?? false;
  const session = new ChatSession({
    getData: () => data,
    persist: async (mutate) => {
      data = mutate(data);
      return true;
    },
    callAgent: async () => ({ toolCall: { id: "1", name: "settings", input } as AgentToolCall & { id: string } }),
    todayISO: () => "2026-10-27",
    readAloud: { deviceId: "phone", supported: () => options.supported ?? true, get: () => reading, set: (on) => (reading = on) },
  });
  await session.send("settings");
  const last = session.messages.filter((message) => message.role === "assistant").pop();
  return { reply: last && "content" in last ? (last.content as string) : "", data, reading };
}

{
  const monday = await run({ weekStartsOn: "monday" });
  assert.equal(weekStartOf(monday.data), 1);
  assert.match(monday.reply, /^Weeks now start on Monday\./);
  assert.equal((await run({ weekStartsOn: "monday" }, { data: monday.data })).reply, "Weeks already start on Monday.");

  const on = await run({ readAloud: true });
  assert.deepEqual([on.reading, on.data.ttsEnabledByDevice], [true, { phone: true }]);
  assert.equal(on.reply, "I'll read replies aloud on this device from now on.");
  assert.equal((await run({ readAloud: true }, { reading: true })).reply, "Replies are already read aloud on this device.");
  const both = await run({ weekStartsOn: "monday", readAloud: false }, { reading: true });
  assert.equal(both.reply, 'Weeks now start on Monday. "This week" and the weekly counts follow it, past weeks included.\nI\'ll stop reading replies aloud on this device.');

  const unsupported = await run({ readAloud: true }, { supported: false });
  assert.match(unsupported.reply, /can't read replies aloud/);
  assert.equal(unsupported.data, base); // nothing saved

  const shown = await run({}, { data: monday.data, reading: true });
  assert.equal(
    shown.reply,
    "Your settings:\n• First day of the week: Monday\n• Read replies aloud on this device: on\nAPI keys, the chat provider and voice transcription are changed in Settings (⚙), not by chat.",
  );
}

console.log("settingsByChat: all assertions passed");
