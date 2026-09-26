import { useEffect, useRef, useState } from "react";
import { Settings as SettingsIcon, CircleHelp, MessageCircle, Calendar, Tags, List, ChartColumn, Timer as TimerIcon } from "lucide-react";
import SignIn from "./components/SignIn";
import Chat from "./components/Chat";
import DayStrip from "./components/DayStrip";
import DayView from "./components/DayView";
import SettingsPanel from "./components/Settings";
import CategoriesView from "./components/CategoriesView";
import HabitsView from "./components/HabitsView";
import SingleTasksView from "./components/SingleTasksView";
import RecurringTasksView from "./components/RecurringTasksView";
import Dashboard from "./components/Dashboard";
import TimerView from "./components/TimerView";
import { useTimerSession } from "./lib/useTimerSession";
import {
  signIn,
  refreshSession,
  tokenNeedsRefresh,
  DriveAuthError,
  findOrCreateFolder,
  findDataFile,
  createDataFile,
  readDataFile,
  writeDataFile,
  DriveConflictError,
  DriveOfflineError,
  type DriveSession,
  type DriveFileRef,
} from "./lib/driveClient";
import { sendMessage, type AgentHistoryMessage } from "./lib/agentClient";
import { loadDebugLog, appendDebugLogEntry, clearDebugLog, type DebugLogEntry } from "./lib/debugLogStore";
import { toDisplayMessages } from "./server/agentHistory";
import {
  addCategory,
  addRecurringTaskChecklistItem,
  addSingleTaskChecklistItem,
  bumpSharedKeyMessageCount,
  deleteCategory,
  isCategoryInUse,
  rolloverPersistentTasks,
  setHabitValue,
  SHARED_KEY_MESSAGE_CAP,
  toggleHabitChecklistItem,
  toggleHabitCompletion,
  toggleRecurringTaskChecklistItem,
  toggleRecurringTaskCompletion,
  toggleSingleTaskChecklistItem,
  toggleSingleTaskDone,
  updateCategory,
  updateSingleTask,
  type CreateCategoryInput,
  type UpdateCategoryPatch,
} from "./lib/dataStore";
import { isFutureDate } from "./lib/recurrence";
import {
  getActiveByok,
  getActiveStt,
  exportState as exportByokState,
  importState as importByokState,
  hasLocalByokSettings,
  type ByokSettings,
} from "./lib/settingsStore";
import {
  getDeviceId,
  getTtsEnabled,
  importTtsEnabled,
} from "./lib/ttsPreference";
import { speak } from "./lib/textToSpeech";
import { ChatSession } from "./lib/chatEngine";
import { emptyAppData, type AppData } from "./types/models";

type Tab = "chat" | "today" | "categories" | "view" | "stats" | "timer";
type ViewSubTab = "habits" | "single tasks" | "recurring tasks";

const TAB_ICONS: Record<Tab, typeof MessageCircle> = {
  chat: MessageCircle,
  today: Calendar,
  categories: Tags,
  view: List,
  stats: ChartColumn,
  timer: TimerIcon,
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

// Issue #7, a dev-server-only test switch, so testing doesn't mean waiting an hour:
// ?tokenTest=expire:60 — the token runs out 60s after sign-in (tests the refresh on tap);
// ?tokenTest=break:60 — it stops working without the app knowing (tests the Reconnect banner).
// Only the first session is affected, so the renewed token works normally.
let tokenTestApplied = false;
function simulateTokenExpiryForTesting(session: DriveSession) {
  if (!import.meta.env.DEV || tokenTestApplied) return;
  const match = new URLSearchParams(window.location.search).get("tokenTest")?.match(/^(expire|break):(\d+)$/);
  if (!match) return;
  tokenTestApplied = true;
  setTimeout(() => {
    session.accessToken = "expired-for-testing";
    if (match[1] === "expire") session.expiresAt = Date.now();
  }, Number(match[2]) * 1000);
}

export default function App() {
  const [session, setSessionState] = useState<DriveSession | null>(null);
  // Issue #7: persist() can run long after the render that created it (a chat turn awaits
  // the model first), and the token may be refreshed in between — so it reads the ref.
  const sessionRef = useRef<DriveSession | null>(null);
  function setSession(next: DriveSession) {
    sessionRef.current = next;
    setSessionState(next);
  }
  const refreshPromiseRef = useRef<Promise<DriveSession> | null>(null);
  // Saves waiting on the Reconnect banner: each resolves true once reconnected, false on cancel.
  const reconnectWaitersRef = useRef<((reconnected: boolean) => void)[]>([]);
  const [reconnectNeeded, setReconnectNeeded] = useState(false);
  const [reconnectError, setReconnectError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [fileRef, setFileRef] = useState<DriveFileRef | null>(null);
  const [data, setData] = useState<AppData | null>(null);

  const [messages, setMessages] = useState<AgentHistoryMessage[]>([]);
  const [sending, setSending] = useState(false);

  const [byok, setByok] = useState<ByokSettings | null>(null);
  const [sttApiKey, setSttApiKey] = useState<string | null>(null);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // §27 in Roadmap.md: hoisted here (not local to Settings.tsx) so the debug
  // log panel updates live while it's open during a chat turn, instead of
  // only reflecting a one-time snapshot taken when it was unlocked.
  const [debugLog, setDebugLog] = useState<DebugLogEntry[]>(() => loadDebugLog());

  const [activeTab, setActiveTab] = useState<Tab>("chat");
  const [viewSubTab, setViewSubTab] = useState<ViewSubTab>("habits");
  const [selectedDate, setSelectedDate] = useState(todayISO());

  // Called here, at the root, not inside TimerView — every tab's component fully unmounts
  // on tab switch (see the render block below), so a running/paused timer needs to live
  // above that switch to survive navigating away and back. See §19 in Roadmap.md.
  const timer = useTimerSession();

  useEffect(() => {
    setByok(getActiveByok());
    setSttApiKey(getActiveStt()?.apiKey ?? null);
    setTtsEnabled(getTtsEnabled());
  }, []);

  function refreshSettings() {
    setByok(getActiveByok());
    setSttApiKey(getActiveStt()?.apiKey ?? null);
    setTtsEnabled(getTtsEnabled());
  }

  // §30 in Roadmap.md: reflects a freshly-loaded AppData's byokSettings into
  // localStorage — called only from the sign-in flow below, never from
  // persist()'s own setData calls, since data.byokSettings there can be stale
  // relative to localStorage while a Settings.tsx save is mid-flight (it
  // writes to localStorage synchronously, then fires an unawaited persist());
  // an unrelated persist() resolving first and importing its stale carried-
  // forward value would silently clobber a key just saved elsewhere.
  function applyRemoteData(next: AppData) {
    importByokState(next.byokSettings);
    importTtsEnabled(next.ttsEnabledByDevice);
    refreshSettings();
    setData(next);
  }

  function recordDebugEntry(entry: DebugLogEntry) {
    appendDebugLogEntry(entry);
    setDebugLog(loadDebugLog());
  }

  function handleClearDebugLog() {
    clearDebugLog();
    setDebugLog([]);
  }

  const prevMessageCountRef = useRef(0);

  // §20 shared-key nudge: pendingSharedKeyBumpRef marks that this turn used the shared
  // trial key and still needs its message counted; attemptedWriteRef marks that some
  // persist() call was already attempted this turn (success or failure) so the
  // fallback flush at the end of handleSend doesn't issue a redundant second write.
  const pendingSharedKeyBumpRef = useRef(false);
  const attemptedWriteRef = useRef(false);

  useEffect(() => {
    const prevCount = prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;
    if (!ttsEnabled || messages.length <= prevCount) return;
    // Read off the display list, not the raw history — a role:"tool" entry
    // can now be the actual last array element, and it has no visible text.
    const display = toDisplayMessages(messages);
    const last = display[display.length - 1];
    if (last?.role === "assistant") speak(last.content);
  }, [messages, ttsEnabled]);

  async function handleSignIn() {
    setSigningIn(true);
    setAuthError(null);
    try {
      const newSession = await signIn(CLIENT_ID);
      setSession(newSession);
      simulateTokenExpiryForTesting(newSession);

      const folderId = await findOrCreateFolder(newSession);
      const existing = await findDataFile(newSession, folderId);
      if (existing) {
        const loaded = await readDataFile(newSession, existing.fileId);
        // §30 in Roadmap.md: migrate this device's local BYOK settings into a
        // Drive file that predates the byokSettings field, so other devices
        // can pick them up on their next sign-in. Computed before rollover so
        // the two don't interact beyond sharing one conditional write below.
        const needsByokMigration = loaded.byokSettings === undefined && hasLocalByokSettings();
        const rolled = rolloverPersistentTasks(loaded, todayISO());
        const toWrite = needsByokMigration ? { ...rolled, byokSettings: exportByokState() } : rolled;
        if (toWrite !== loaded) {
          try {
            const newRef = await writeDataFile(newSession, existing, toWrite);
            setFileRef(newRef);
            applyRemoteData(toWrite);
          } catch {
            // Rollover/migration write failed (conflict, network, etc.) — don't block sign-in
            // over a nice-to-have correction; just show the un-rolled-over data this session.
            // loaded.byokSettings is still undefined here, so this device's local settings are
            // left untouched — migration is simply retried on the next sign-in.
            setFileRef(existing);
            applyRemoteData(loaded);
          }
        } else {
          setFileRef(existing);
          applyRemoteData(loaded);
        }
      } else {
        const initial = emptyAppData();
        // Covers a device signing in fresh (e.g. reinstalled) with pre-existing local BYOK
        // settings — not just the "existing file, missing field" migration above — so a second
        // device isn't stuck waiting on a transition that never happens on this one.
        const withByok = hasLocalByokSettings() ? { ...initial, byokSettings: exportByokState() } : initial;
        const created = await createDataFile(newSession, folderId, withByok);
        setFileRef(created);
        applyRemoteData(withByok);
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setSigningIn(false);
    }
  }

  /** One refresh at a time: a chat send and its save share the same popup. */
  function refreshToken(): Promise<DriveSession> {
    if (!refreshPromiseRef.current) {
      refreshPromiseRef.current = refreshSession(CLIENT_ID)
        .then((next) => {
          setSession(next);
          return next;
        })
        .finally(() => {
          refreshPromiseRef.current = null;
        });
    }
    return refreshPromiseRef.current;
  }

  /**
   * Issue #7: the session, renewed first if its token is about to expire. Called at the start
   * of a tap (send, checkbox, timer save) so the refresh popup counts as tap-started and isn't
   * blocked. If the refresh fails, returns the old session; a 401 then leads to the banner.
   */
  async function freshSession(): Promise<DriveSession | null> {
    const current = sessionRef.current;
    if (!current || !tokenNeedsRefresh(current)) return current;
    try {
      return await refreshToken();
    } catch {
      return sessionRef.current;
    }
  }

  /** Shows the Reconnect banner and waits for the user's answer. */
  function waitForReconnect(): Promise<boolean> {
    setReconnectNeeded(true);
    return new Promise((resolve) => reconnectWaitersRef.current.push(resolve));
  }

  function settleReconnect(reconnected: boolean) {
    const waiters = reconnectWaitersRef.current;
    reconnectWaitersRef.current = [];
    setReconnectNeeded(false);
    setReconnectError(null);
    waiters.forEach((resolve) => resolve(reconnected));
  }

  async function handleReconnect() {
    setReconnectError(null);
    try {
      await refreshToken();
      settleReconnect(true);
    } catch (err) {
      setReconnectError(err instanceof Error ? err.message : "Couldn't reconnect.");
    }
  }

  /**
   * Takes the mutation itself (not a precomputed AppData) so that on a write conflict it can
   * be replayed against freshly reloaded remote data — see §21 in Roadmap.md. Two attempts
   * total: attempt 1 against this render's `data`; on a conflict, reload remote data and
   * replay `mutate` against it for attempt 2. Returns whether the save actually succeeded, so
   * callers don't confirm an action that didn't happen.
   */
  async function persist(mutate: (data: AppData) => AppData): Promise<boolean> {
    attemptedWriteRef.current = true;
    if (!sessionRef.current || !fileRef || !data) return false;
    await freshSession();

    let baseData = data;
    let ref = fileRef;
    let reconnects = 0;

    for (let attempt = 1; attempt <= 2; attempt++) {
      const toWrite = pendingSharedKeyBumpRef.current ? bumpSharedKeyMessageCount(mutate(baseData)) : mutate(baseData);
      try {
        const newRef = await writeDataFile(sessionRef.current!, ref, toWrite);
        setFileRef(newRef);
        setData(toWrite);
        pendingSharedKeyBumpRef.current = false;
        return true;
      } catch (err) {
        // Issue #7: the sign-in expired. Wait for Reconnect, then retry this same attempt; the
        // mutation is replayed, so what the user asked for isn't lost.
        if (err instanceof DriveAuthError) {
          if (reconnects < 2 && (await waitForReconnect())) {
            reconnects += 1;
            attempt -= 1;
            continue;
          }
          pushAssistantMessage("That wasn't saved, because your Google sign-in expired. Reconnect, then try it again.");
          return false;
        }
        if (err instanceof DriveConflictError && attempt === 1) {
          try {
            baseData = await readDataFile(sessionRef.current!, ref.fileId);
            ref = { fileId: ref.fileId, modifiedTime: err.currentModifiedTime };
          } catch (reloadErr) {
            pushAssistantMessage(
              reloadErr instanceof DriveAuthError
                ? "That wasn't saved, because your Google sign-in expired. Reconnect, then try it again."
                : reloadErr instanceof DriveOfflineError
                ? "You're offline — this didn't save. Try again once you're back online."
                : `Sorry, I couldn't save that: ${reloadErr instanceof Error ? reloadErr.message : "unknown error"}.`,
            );
            return false;
          }
          continue; // retry, replaying `mutate` against the freshly reloaded baseData
        }
        if (err instanceof DriveConflictError) {
          // Retries exhausted — still conflicting, most likely genuinely concurrent edits from
          // two devices in a tight window. Resync UI state to baseData/ref (the one reload we
          // did after attempt 1) so the user at least sees the freshest data we actually saw,
          // even though the write itself failed — mirrors the pre-§21 behavior of always
          // reflecting the latest known remote state on a conflict.
          setData(baseData);
          setFileRef(ref);
          pushAssistantMessage("Your data keeps changing on another device — please try that again in a moment.");
          return false;
        }
        if (err instanceof DriveOfflineError) {
          pushAssistantMessage("You're offline — this didn't save. Try again once you're back online.");
          return false;
        }
        pushAssistantMessage(
          `Sorry, I couldn't save that: ${err instanceof Error ? err.message : "unknown error"}.`,
        );
        return false;
      }
    }
    return false;
  }

  // §33 in Roadmap.md: the chat turn logic lives in a UI-free ChatSession (src/lib/chatEngine.ts),
  // shared with the headless chat-scenario tests. `latestRef` gives that long-lived session this
  // render's data/persist/byok rather than the ones captured when it was created.
  const latestRef = useRef({ data, persist, byok });
  latestRef.current = { data, persist, byok };
  const chatRef = useRef<ChatSession | null>(null);
  if (!chatRef.current) {
    const session = new ChatSession({
      getData: () => latestRef.current.data,
      persist: (mutate) => latestRef.current.persist(mutate),
      callAgent: (history, categories, hasPendingConfirmation) =>
        sendMessage(history, latestRef.current.byok, categories, hasPendingConfirmation),
      todayISO,
      onDebug: (entry) => recordDebugEntry(entry),
      onChange: () => setMessages(session.messages),
      beforeModelCall: ({ hasPendingConfirmation }) => {
        const current = latestRef.current;
        const usingSharedKey = !current.byok;
        // Skip the gate while a confirmation is outstanding — it only has a chat-based
        // confirm/decline path, so blocking it here would leave it stuck with no way to resolve.
        if (
          usingSharedKey &&
          !hasPendingConfirmation &&
          (current.data?.sharedKeyMessageCount ?? 0) >= SHARED_KEY_MESSAGE_CAP
        ) {
          return (
            `You've used all ${SHARED_KEY_MESSAGE_CAP} free trial messages. Open Settings (⚙) and add your own free Groq or Gemini key — ` +
            "it takes about a minute. Step-by-step guide: /api-key-setup.html"
          );
        }
        pendingSharedKeyBumpRef.current = usingSharedKey;
        return null;
      },
    });
    chatRef.current = session;
  }

  function pushAssistantMessage(content: string) {
    chatRef.current?.pushAssistantMessage(content);
  }

  async function handleSend(userText: string) {
    if (!data || !chatRef.current) return;
    attemptedWriteRef.current = false;
    // Issue #7: renew an expiring token now, while the tap still counts — the save only
    // happens after the model replies, too late for a popup.
    void freshSession();
    setSending(true);
    try {
      await chatRef.current.send(userText);
      // No write happened this turn (e.g. a plain reply, or a "couldn't find a
      // match" message) — flush the pending shared-key count on its own so it isn't lost.
      if (pendingSharedKeyBumpRef.current && !attemptedWriteRef.current) {
        await persist((current) => current);
      }
    } finally {
      // Never let a bump flag survive past this turn — if persist() failed above and
      // never cleared it, leaving it set would incorrectly attach the shared-key count
      // to some later, unrelated persist() call (e.g. a direct habit-checkbox toggle).
      pendingSharedKeyBumpRef.current = false;
      setSending(false);
    }
  }

  function handleTaskToggle(taskId: string) {
    if (!data) return;
    void persist((current) => toggleSingleTaskDone(current, taskId));
  }

  // §29: the controls for these are already disabled on a future day — these guards are
  // the second line, so a stale render can't write a completion that hasn't happened.
  function handleHabitToggle(habitId: string) {
    if (!data || isFutureDate(selectedDate, todayISO())) return;
    void persist((current) => toggleHabitCompletion(current, habitId, selectedDate));
  }

  function handleRecurringTaskToggle(taskId: string) {
    if (!data || isFutureDate(selectedDate, todayISO())) return;
    void persist((current) => toggleRecurringTaskCompletion(current, taskId, selectedDate));
  }

  function handleHabitChecklistToggle(habitId: string, itemId: string, dateISO: string) {
    if (!data || isFutureDate(dateISO, todayISO())) return;
    void persist((current) => toggleHabitChecklistItem(current, habitId, itemId, dateISO));
  }

  // §29: completing a one-off task early is allowed, but only after the user confirms in
  // DayView — and the task moves to today, so its record says when it was actually done.
  function handleFutureTaskComplete(taskId: string) {
    if (!data) return;
    void persist((current) => updateSingleTask(current, taskId, { newDone: true, newStartDate: todayISO() }));
  }

  function handleRecurringTaskChecklistToggle(taskId: string, itemId: string) {
    if (!data) return;
    void persist((current) => toggleRecurringTaskChecklistItem(current, taskId, itemId));
  }

  function handleSingleTaskChecklistToggle(taskId: string, itemId: string) {
    if (!data) return;
    void persist((current) => toggleSingleTaskChecklistItem(current, taskId, itemId));
  }

  function handleRecurringTaskChecklistAdd(taskId: string, text: string) {
    if (!data) return;
    void persist((current) => addRecurringTaskChecklistItem(current, taskId, text));
  }

  function handleSingleTaskChecklistAdd(taskId: string, text: string) {
    if (!data) return;
    void persist((current) => addSingleTaskChecklistItem(current, taskId, text));
  }

  // §19 in Roadmap.md: saving a stopped timer session adds to (not overwrites) whatever's
  // already logged for that habit today — same delta-inside-the-mutator pattern as
  // handleLogHabitProgress above, so a conflict-retry replay re-derives against fresh data.
  async function handleSaveTimer(habitId: string, elapsedMs: number): Promise<boolean> {
    const elapsedMinutes = elapsedMs / 60_000;
    const dateISO = todayISO();
    return persist((latest) => {
      const currentValue = latest.completionLog.find((entry) => entry.itemId === habitId && entry.date === dateISO)?.value ?? 0;
      return setHabitValue(latest, habitId, dateISO, currentValue + elapsedMinutes);
    });
  }

  function handleAddCategory(input: CreateCategoryInput) {
    if (!data) return;
    void persist((current) => addCategory(current, input));
  }

  function handleUpdateCategory(id: string, patch: UpdateCategoryPatch) {
    if (!data) return;
    void persist((current) => updateCategory(current, id, patch));
  }

  function handleDeleteCategory(id: string): boolean {
    if (!data) return false;
    if (isCategoryInUse(data, id)) return false;
    void persist((current) => deleteCategory(current, id));
    return true;
  }

  if (!session || !data) {
    return <SignIn onClick={handleSignIn} loading={signingIn} error={authError} />;
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Habit Assistant</h1>
        <div className="flex gap-2">
          {/* §38: the user manual, a static page precached like api-key-setup.html. */}
          <a
            href="/help.html"
            target="_blank"
            rel="noreferrer"
            className="rounded-md bg-slate-800 p-2 hover:bg-slate-700"
            aria-label="Help"
            title="Help"
          >
            <CircleHelp className="h-4 w-4" />
          </a>
          <button
            onClick={() => setSettingsOpen((open) => !open)}
            className="rounded-md bg-slate-800 p-2 hover:bg-slate-700"
            aria-label="Settings"
          >
            <SettingsIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {reconnectNeeded && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-400/40 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">
          <span className="flex-1">Your Google sign-in expired, so this hasn't been saved yet.</span>
          <button
            onClick={handleReconnect}
            className="rounded-md bg-violet-500 px-3 py-1 text-white hover:bg-violet-400"
          >
            Reconnect
          </button>
          <button onClick={() => settleReconnect(false)} className="rounded-md bg-slate-700 px-3 py-1 hover:bg-slate-600">
            Cancel
          </button>
          {reconnectError && <p className="w-full text-xs text-red-300">{reconnectError}</p>}
        </div>
      )}

      {settingsOpen && (
        <SettingsPanel
          activeProvider={byok?.provider ?? null}
          sharedKeyExhausted={(data.sharedKeyMessageCount ?? 0) >= SHARED_KEY_MESSAGE_CAP}
          onChange={() => {
            refreshSettings();
            // §30 in Roadmap.md: push the whole BYOK blob to Drive on every
            // Settings.tsx mutation (it already calls onChange after each one).
            // ttsEnabledByDevice is a per-device map, not a whole-blob sync —
            // merge in only this device's own key so a conflict-retry replay
            // (current is the freshly-reloaded object then) never clobbers a
            // different device's entry.
            void persist((current) => ({
              ...current,
              byokSettings: exportByokState(),
              ttsEnabledByDevice: { ...current.ttsEnabledByDevice, [getDeviceId()]: getTtsEnabled() },
            }));
          }}
          onClose={() => setSettingsOpen(false)}
          debugLog={debugLog}
          onClearDebugLog={handleClearDebugLog}
        />
      )}

      <div className="flex gap-2">
        {(["chat", "today", "categories", "view", "stats", "timer"] as const).map((tab) => {
          const Icon = TAB_ICONS[tab];
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              aria-label={tab}
              title={tab}
              className={`flex flex-1 items-center justify-center rounded-md p-2 ${
                activeTab === tab ? "bg-violet-500 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
              }`}
            >
              <Icon className="h-4 w-4" />
            </button>
          );
        })}
      </div>

      <div className="min-h-[60vh] flex-1">
        {activeTab === "chat" && (
          <Chat
            messages={messages}
            onSend={handleSend}
            sending={sending}
            sttApiKey={sttApiKey}
            byokProvider={byok?.provider ?? null}
          />
        )}

        {activeTab === "today" && (
          <div className="flex flex-col gap-4">
            <DayStrip selectedDate={selectedDate} onSelect={setSelectedDate} />
            <DayView
              selectedDate={selectedDate}
              todayISO={todayISO()}
              habits={data.habits}
              singleTasks={data.singleTasks}
              recurringTasks={data.recurringTasks}
              completionLog={data.completionLog}
              categories={data.categories}
              onToggleHabit={handleHabitToggle}
              onToggleTask={handleTaskToggle}
              onToggleRecurringTask={handleRecurringTaskToggle}
              onToggleHabitChecklistItem={(habitId, itemId) => handleHabitChecklistToggle(habitId, itemId, selectedDate)}
              onCompleteFutureTask={handleFutureTaskComplete}
              onToggleTaskChecklistItem={handleSingleTaskChecklistToggle}
              onAddTaskChecklistItem={handleSingleTaskChecklistAdd}
              onToggleRecurringTaskChecklistItem={handleRecurringTaskChecklistToggle}
              onAddRecurringTaskChecklistItem={handleRecurringTaskChecklistAdd}
            />
          </div>
        )}

        {activeTab === "categories" && (
          <CategoriesView
            categories={data.categories}
            habits={data.habits}
            recurringTasks={data.recurringTasks}
            singleTasks={data.singleTasks}
            completionLog={data.completionLog}
            onAdd={handleAddCategory}
            onUpdate={handleUpdateCategory}
            onDelete={handleDeleteCategory}
          />
        )}

        {activeTab === "view" && (
          <div className="flex flex-col gap-4">
            <div className="flex gap-4 border-b border-slate-700">
              {(["habits", "single tasks", "recurring tasks"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setViewSubTab(tab)}
                  className={`pb-1.5 text-xs capitalize ${
                    viewSubTab === tab
                      ? "border-b-2 border-violet-500 text-white"
                      : "border-b-2 border-transparent text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {viewSubTab === "habits" && (
              <HabitsView
                habits={data.habits}
                categories={data.categories}
                completionLog={data.completionLog}
                onToggleChecklistItem={(habitId, itemId) => handleHabitChecklistToggle(habitId, itemId, todayISO())}
              />
            )}

            {viewSubTab === "single tasks" && (
              <SingleTasksView
                singleTasks={data.singleTasks}
                categories={data.categories}
                onToggleChecklistItem={handleSingleTaskChecklistToggle}
                onAddChecklistItem={handleSingleTaskChecklistAdd}
              />
            )}

            {viewSubTab === "recurring tasks" && (
              <RecurringTasksView
                recurringTasks={data.recurringTasks}
                categories={data.categories}
                onToggleChecklistItem={handleRecurringTaskChecklistToggle}
                onAddChecklistItem={handleRecurringTaskChecklistAdd}
              />
            )}
          </div>
        )}

        {activeTab === "stats" && (
          <Dashboard
            habits={data.habits}
            categories={data.categories}
            completionLog={data.completionLog}
            onViewCategories={() => setActiveTab("categories")}
          />
        )}

        {activeTab === "timer" && <TimerView habits={data.habits} timer={timer} onSave={handleSaveTimer} />}
      </div>
    </div>
  );
}
