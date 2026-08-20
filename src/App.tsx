import { useEffect, useState } from "react";
import SignIn from "./components/SignIn";
import Chat from "./components/Chat";
import ItemList from "./components/ItemList";
import DayStrip from "./components/DayStrip";
import HabitDayView from "./components/HabitDayView";
import SettingsPanel from "./components/Settings";
import {
  signIn,
  findOrCreateFolder,
  findDataFile,
  createDataFile,
  readDataFile,
  writeDataFile,
  DriveConflictError,
  type DriveSession,
  type DriveFileRef,
} from "./lib/driveClient";
import { sendMessage, type ChatMessage } from "./lib/agentClient";
import {
  addHabit,
  addSingleTask,
  deleteHabits,
  deleteRecurringTasks,
  deleteSingleTasks,
  resolveHabits,
  resolveRecurringTasks,
  resolveSingleTasks,
  toggleHabitCompletion,
  toggleSingleTaskDone,
  updateHabit,
  updateRecurringTask,
  updateSingleTask,
  type DeleteCriteria,
  type UpdatePatch,
} from "./lib/dataStore";
import { getActiveByok, getActiveStt, type ByokSettings } from "./lib/settingsStore";
import { emptyAppData, type AppData } from "./types/models";

type Tab = "chat" | "today" | "tasks";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

type DeletableItemKind = "singleTask" | "habit" | "recurringTask";

interface PendingDeletion {
  itemKind: DeletableItemKind;
  ids: string[];
  names: string[];
}

function formatQuotedList(names: string[]): string {
  return names.map((name) => `"${name}"`).join(", ");
}

const ITEM_NOUNS: Record<DeletableItemKind, string> = {
  singleTask: "task",
  habit: "habit",
  recurringTask: "recurring task",
};

function buildDeleteConfirmationQuestion(kind: DeletableItemKind, names: string[]): string {
  const noun = ITEM_NOUNS[kind];
  const subject =
    names.length === 1
      ? `the ${noun} ${formatQuotedList(names)}`
      : `these ${names.length} ${noun}s: ${formatQuotedList(names)}`;
  const historyWarning =
    kind !== "singleTask" ? " This will also permanently delete its tracked completion history." : "";
  return `Are you sure you want to delete ${subject}?${historyWarning}`;
}

/** Fast-path eligibility: only an unambiguous single-name filter, nothing else composed with it. */
function isNameOnlyCriteria(criteria: DeleteCriteria): boolean {
  const { name, ...rest } = criteria;
  if (typeof name !== "string" || name.trim().length === 0) return false;
  return Object.values(rest).every((value) => value === undefined);
}

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

export default function App() {
  const [session, setSession] = useState<DriveSession | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [fileRef, setFileRef] = useState<DriveFileRef | null>(null);
  const [data, setData] = useState<AppData | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);

  const [byok, setByok] = useState<ByokSettings | null>(null);
  const [sttApiKey, setSttApiKey] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [activeTab, setActiveTab] = useState<Tab>("chat");
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [pendingDeletion, setPendingDeletion] = useState<PendingDeletion | null>(null);

  useEffect(() => {
    setByok(getActiveByok());
    setSttApiKey(getActiveStt()?.apiKey ?? null);
  }, []);

  function refreshSettings() {
    setByok(getActiveByok());
    setSttApiKey(getActiveStt()?.apiKey ?? null);
  }

  async function handleSignIn() {
    setSigningIn(true);
    setAuthError(null);
    try {
      const newSession = await signIn(CLIENT_ID);
      setSession(newSession);

      const folderId = await findOrCreateFolder(newSession);
      const existing = await findDataFile(newSession, folderId);
      if (existing) {
        const loaded = await readDataFile(newSession, existing.fileId);
        setFileRef(existing);
        setData(loaded);
      } else {
        const initial = emptyAppData();
        const created = await createDataFile(newSession, folderId, initial);
        setFileRef(created);
        setData(initial);
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setSigningIn(false);
    }
  }

  /** Returns whether the save actually succeeded, so callers don't confirm an action that didn't happen. */
  async function persist(nextData: AppData): Promise<boolean> {
    if (!session || !fileRef) return false;
    try {
      const newRef = await writeDataFile(session, fileRef, nextData);
      setFileRef(newRef);
      setData(nextData);
      return true;
    } catch (err) {
      if (err instanceof DriveConflictError) {
        const latest = await readDataFile(session, fileRef.fileId);
        setData(latest);
        pushAssistantMessage(
          "Your data changed on another device, so I reloaded the latest version — please try that again.",
        );
        return false;
      }
      pushAssistantMessage(
        `Sorry, I couldn't save that: ${err instanceof Error ? err.message : "unknown error"}.`,
      );
      return false;
    }
  }

  function pushAssistantMessage(content: string) {
    setMessages((prev) => [...prev, { role: "assistant", content }]);
  }

  async function handleDeleteRequest(kind: DeletableItemKind, criteria: DeleteCriteria) {
    if (!data) return;
    const matches =
      kind === "habit"
        ? resolveHabits(data, criteria)
        : kind === "recurringTask"
          ? resolveRecurringTasks(data, criteria)
          : resolveSingleTasks(data, criteria);

    if (matches.length === 0) {
      pushAssistantMessage("I couldn't find anything matching that to delete.");
      return;
    }

    const ids = matches.map((match) => match.id);
    const names = matches.map((match) => match.name);

    if (kind === "singleTask" && isNameOnlyCriteria(criteria) && matches.length === 1) {
      const saved = await persist(deleteSingleTasks(data, ids));
      if (saved) pushAssistantMessage(`Deleted "${names[0]}".`);
      return;
    }

    setPendingDeletion({ itemKind: kind, ids, names });
    pushAssistantMessage(buildDeleteConfirmationQuestion(kind, names));
  }

  async function resolvePendingDeletion(confirmed: boolean) {
    const pending = pendingDeletion;
    setPendingDeletion(null);
    if (!pending || !data) return;

    if (!confirmed) {
      pushAssistantMessage("Okay, I won't delete that.");
      return;
    }

    const nextData =
      pending.itemKind === "habit"
        ? deleteHabits(data, pending.ids)
        : pending.itemKind === "recurringTask"
          ? deleteRecurringTasks(data, pending.ids)
          : deleteSingleTasks(data, pending.ids);
    const saved = await persist(nextData);
    if (saved) pushAssistantMessage(`Deleted ${formatQuotedList(pending.names)}.`);
  }

  function hasAnyPatchField(patch: UpdatePatch): boolean {
    return Object.values(patch).some((value) => value !== undefined);
  }

  async function handleUpdateRequest(kind: DeletableItemKind, input: { name: string } & UpdatePatch) {
    if (!data) return;
    const { name: fragment, ...patch } = input;
    const matches =
      kind === "habit"
        ? resolveHabits(data, { name: fragment })
        : kind === "recurringTask"
          ? resolveRecurringTasks(data, { name: fragment })
          : resolveSingleTasks(data, { name: fragment });

    if (matches.length === 0) {
      pushAssistantMessage(`I couldn't find any ${ITEM_NOUNS[kind]} matching "${fragment}".`);
      return;
    }
    if (matches.length > 1) {
      pushAssistantMessage(
        `I found more than one ${ITEM_NOUNS[kind]} matching "${fragment}": ${formatQuotedList(matches.map((match) => match.name))}. Which one did you mean?`,
      );
      return;
    }
    if (!hasAnyPatchField(patch)) {
      pushAssistantMessage("What would you like to change about it?");
      return;
    }

    const target = matches[0];
    const nextData =
      kind === "habit"
        ? updateHabit(data, target.id, patch)
        : kind === "recurringTask"
          ? updateRecurringTask(data, target.id, patch)
          : updateSingleTask(data, target.id, patch);

    const saved = await persist(nextData);
    if (saved) pushAssistantMessage(`Updated "${target.name}".`);
  }

  async function handleSend(userText: string) {
    if (!data) return;
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: userText }];
    setMessages(nextMessages);
    setSending(true);
    try {
      const response = await sendMessage(nextMessages, byok, data.categories, pendingDeletion !== null);

      if (pendingDeletion) {
        // Tools were restricted server-side to confirmPendingDeletion only; anything else
        // (a plain reply, no tool call) is treated as a decline — fail closed on a destructive action.
        const confirmed =
          response.toolCall?.name === "confirmPendingDeletion" && response.toolCall.input.confirmed === true;
        await resolvePendingDeletion(confirmed);
      } else if (response.toolCall?.name === "createSingleTask") {
        const nextData = addSingleTask(data, response.toolCall.input);
        const saved = await persist(nextData);
        if (saved) {
          pushAssistantMessage(`Added "${response.toolCall.input.name}" to your tasks.`);
        }
      } else if (response.toolCall?.name === "createHabit") {
        const nextData = addHabit(data, response.toolCall.input);
        const saved = await persist(nextData);
        if (saved) {
          pushAssistantMessage(`Added "${response.toolCall.input.name}" as a habit.`);
        }
      } else if (response.toolCall?.name === "deleteSingleTasks") {
        await handleDeleteRequest("singleTask", response.toolCall.input);
      } else if (response.toolCall?.name === "deleteHabits") {
        await handleDeleteRequest("habit", response.toolCall.input);
      } else if (response.toolCall?.name === "deleteRecurringTasks") {
        await handleDeleteRequest("recurringTask", response.toolCall.input);
      } else if (response.toolCall?.name === "updateSingleTask") {
        await handleUpdateRequest("singleTask", response.toolCall.input);
      } else if (response.toolCall?.name === "updateHabit") {
        await handleUpdateRequest("habit", response.toolCall.input);
      } else if (response.toolCall?.name === "updateRecurringTask") {
        await handleUpdateRequest("recurringTask", response.toolCall.input);
      } else if (response.reply) {
        pushAssistantMessage(response.reply);
      } else {
        pushAssistantMessage("I didn't get a usable response — try rephrasing?");
      }
    } catch (err) {
      pushAssistantMessage(err instanceof Error ? err.message : "Something went wrong talking to the assistant.");
      // pendingDeletion is deliberately left untouched here — only a real
      // response (or explicit decline) clears it, so a transient network
      // failure while awaiting confirmation doesn't silently drop it.
    } finally {
      setSending(false);
    }
  }

  function handleToggle(taskId: string) {
    if (!data) return;
    void persist(toggleSingleTaskDone(data, taskId));
  }

  function handleHabitToggle(habitId: string) {
    if (!data) return;
    void persist(toggleHabitCompletion(data, habitId, selectedDate));
  }

  if (!session || !data) {
    return <SignIn onClick={handleSignIn} loading={signingIn} error={authError} />;
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Habit Assistant</h1>
        <button
          onClick={() => setSettingsOpen((open) => !open)}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700"
        >
          {byok ? `Using your ${byok.provider} key` : "Using free trial"} ⚙
        </button>
      </div>

      {settingsOpen && (
        <SettingsPanel
          activeProvider={byok?.provider ?? null}
          onChange={refreshSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      <div className="flex gap-2">
        {(["chat", "today", "tasks"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`rounded-md px-3 py-1.5 text-sm capitalize ${
              activeTab === tab ? "bg-violet-500 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="min-h-[60vh] flex-1">
        {activeTab === "chat" && (
          <Chat messages={messages} onSend={handleSend} sending={sending} sttApiKey={sttApiKey} />
        )}

        {activeTab === "today" && (
          <div className="flex flex-col gap-4">
            <DayStrip selectedDate={selectedDate} onSelect={setSelectedDate} />
            <HabitDayView
              selectedDate={selectedDate}
              habits={data.habits}
              completionLog={data.completionLog}
              categories={data.categories}
              onToggle={handleHabitToggle}
            />
          </div>
        )}

        {activeTab === "tasks" && (
          <div>
            <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-slate-400">Tasks</h2>
            <ItemList tasks={data.singleTasks} onToggle={handleToggle} />
          </div>
        )}
      </div>
    </div>
  );
}
