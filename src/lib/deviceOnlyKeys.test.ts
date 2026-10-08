// §47 in Roadmap.md: a key kept on this device only never reaches the Drive file, and what
// comes back from Drive at sign-in can neither overwrite nor delete it. Plain-assert style,
// run under tsx, with an in-memory stand-in for the browser's localStorage.
// Run: npm run test:deviceOnlyKeys
import assert from "node:assert/strict";
import type { SyncedByokSettings } from "../types/models.ts";

const storage = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, value),
  removeItem: (key: string) => void storage.delete(key),
};

const {
  defaultDeviceOnly,
  exportState,
  forgetProviderKey,
  getActiveByok,
  getActiveStt,
  getSavedKey,
  hasLocalByokSettings,
  importState,
  isDeviceOnly,
  saveProviderKey,
  setActiveProvider,
  setDeviceOnly,
  setSttUsesOwnKey,
} = await import("./settingsStore.ts");

const reset = () => storage.clear();
const inDrive = (state: SyncedByokSettings) => JSON.stringify(state);

// The default: only an Anthropic key starts device-only.
assert.equal(defaultDeviceOnly("anthropic"), true);
assert.equal(defaultDeviceOnly("groq"), false);
assert.equal(defaultDeviceOnly("gemini"), false);

// A synced key behaves exactly as before §47.
{
  reset();
  saveProviderKey("gemini", "gem-key");
  assert.equal(isDeviceOnly("gemini"), false);
  assert.deepEqual(exportState(), { activeProvider: "gemini", keys: { gemini: { apiKey: "gem-key" } } });
  assert.equal(hasLocalByokSettings(), true);
}

// A device-only key: usable here, absent from what goes to Drive — the key, the fact that
// it's active, and the device-only list itself.
{
  reset();
  saveProviderKey("anthropic", "ant-secret", undefined, true);
  assert.equal(isDeviceOnly("anthropic"), true);
  assert.equal(getActiveByok()?.apiKey, "ant-secret");
  const exported = exportState();
  assert.deepEqual(exported, { activeProvider: null, keys: {} });
  assert.ok(!inDrive(exported).includes("ant-secret"));
  assert.ok(!inDrive(exported).includes("deviceOnly"));
  // Nothing worth migrating into a Drive file that has no settings yet.
  assert.equal(hasLocalByokSettings(), false);
}

// Sign-in: Drive can neither delete a device-only key (it has none for that provider)...
{
  reset();
  saveProviderKey("anthropic", "ant-secret", undefined, true);
  importState({ activeProvider: null, keys: {} });
  assert.equal(getSavedKey("anthropic")?.apiKey, "ant-secret");
  assert.equal(isDeviceOnly("anthropic"), true);
  assert.equal(getActiveByok()?.provider, "anthropic", "still the active provider on this device");

  // ...nor overwrite it (another device synced its own key for the same provider), while
  // synced keys for other providers still arrive.
  importState({ activeProvider: "groq", keys: { anthropic: { apiKey: "ant-other-device" }, groq: { apiKey: "groq-synced" } } });
  assert.equal(getSavedKey("anthropic")?.apiKey, "ant-secret");
  assert.equal(getSavedKey("groq")?.apiKey, "groq-synced");
  assert.equal(getActiveByok()?.provider, "anthropic");
  assert.equal(isDeviceOnly("groq"), false);

  // An old Drive file without the field changes nothing.
  importState(undefined);
  assert.equal(getSavedKey("anthropic")?.apiKey, "ant-secret");
}

// When the active provider here is a synced one, Drive's choice is taken as before, and
// the device-only key is still kept.
{
  reset();
  saveProviderKey("anthropic", "ant-secret", undefined, true);
  saveProviderKey("groq", "groq-key");
  importState({ activeProvider: "gemini", keys: { gemini: { apiKey: "gem-synced" } } });
  assert.equal(getActiveByok()?.provider, "gemini");
  assert.equal(getSavedKey("anthropic")?.apiKey, "ant-secret");
  assert.equal(getSavedKey("groq"), null, "a synced key Drive no longer has is gone, as before");
}

// While a device-only key is active here, this device doesn't push its choice: the Drive
// file keeps the active provider the other devices chose, if its key is synced.
{
  reset();
  saveProviderKey("groq", "groq-key");
  saveProviderKey("anthropic", "ant-secret", undefined, true);
  assert.equal(exportState({ activeProvider: "groq", keys: { groq: { apiKey: "groq-key" } } }).activeProvider, "groq");
  assert.equal(exportState({ activeProvider: null, keys: {} }).activeProvider, null);
  // Drive still names the provider whose key just left the file: cleared rather than left dangling.
  assert.equal(exportState({ activeProvider: "anthropic", keys: { anthropic: { apiKey: "ant-secret" } } }).activeProvider, null);
  // Switching to a synced provider here is pushed again.
  setActiveProvider("groq");
  assert.equal(exportState({ activeProvider: null, keys: {} }).activeProvider, "groq");
}

// Turning the option on for a key that was synced takes it out of the next export;
// turning it off puts it back.
{
  reset();
  saveProviderKey("anthropic", "ant-secret");
  assert.ok(inDrive(exportState()).includes("ant-secret"));
  setDeviceOnly("anthropic", true);
  assert.ok(!inDrive(exportState({ activeProvider: "anthropic", keys: { anthropic: { apiKey: "ant-secret" } } })).includes("ant-secret"));
  assert.equal(getActiveByok()?.apiKey, "ant-secret", "still works on this device");
  setDeviceOnly("anthropic", false);
  assert.deepEqual(exportState().keys, { anthropic: { apiKey: "ant-secret" } });
  assert.equal(exportState().activeProvider, "anthropic");
}

// Updating a key keeps or changes the choice with it; forgetting it clears the choice.
{
  reset();
  saveProviderKey("anthropic", "ant-1", undefined, true);
  saveProviderKey("anthropic", "ant-2", undefined, true);
  assert.equal(isDeviceOnly("anthropic"), true);
  saveProviderKey("anthropic", "ant-3", undefined, false);
  assert.equal(isDeviceOnly("anthropic"), false);
  setDeviceOnly("anthropic", true);
  forgetProviderKey("anthropic");
  assert.equal(isDeviceOnly("anthropic"), false);
  assert.equal(getActiveByok(), null);
  // The option means nothing without a key.
  setDeviceOnly("gemini", true);
  assert.equal(isDeviceOnly("gemini"), false);
  assert.deepEqual(exportState(), { activeProvider: null, keys: {} });
}

// Voice input with a device-only Groq key: that choice stays here too.
{
  reset();
  saveProviderKey("groq", "groq-secret", undefined, true);
  setSttUsesOwnKey(true);
  assert.equal(getActiveStt()?.apiKey, "groq-secret");
  assert.equal(exportState({ activeProvider: null, keys: {} }).sttUsesOwnKey, undefined);
  assert.equal(exportState({ activeProvider: null, keys: {}, sttUsesOwnKey: false }).sttUsesOwnKey, false);
  importState({ activeProvider: null, keys: {}, sttUsesOwnKey: false });
  assert.equal(getActiveStt()?.apiKey, "groq-secret", "another device's choice doesn't switch it off here");

  // With a synced Groq key the toggle syncs as before.
  setDeviceOnly("groq", false);
  assert.equal(exportState().sttUsesOwnKey, true);
  importState({ activeProvider: "groq", keys: { groq: { apiKey: "groq-secret" } }, sttUsesOwnKey: false });
  assert.equal(getActiveStt(), null);
}

console.log("deviceOnlyKeys.test.ts: all passed");
