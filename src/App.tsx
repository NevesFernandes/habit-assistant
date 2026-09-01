import { useEffect, useRef, useState } from "react";
import SignIn from "./components/SignIn";
import Chat from "./components/Chat";
import DayStrip from "./components/DayStrip";
import DayView from "./components/DayView";
import SettingsPanel from "./components/Settings";
import CategoriesView from "./components/CategoriesView";
import HabitsView from "./components/HabitsView";
import SingleTasksView from "./components/SingleTasksView";
import RecurringTasksView from "./components/RecurringTasksView";
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
import { sendMessage, type AgentHistoryMessage } from "./lib/agentClient";
import { toDisplayMessages } from "./server/agentHistory";
import {
  addCategory,
  addHabit,
  addRecurringTask,
  addSingleTask,
  deleteCategory,
  deleteHabits,
  deleteRecurringTasks,
  deleteSingleTasks,
  isCategoryInUse,
  resolveHabits,
  resolveRecurringTasks,
  resolveSingleTasks,
  rolloverPersistentTasks,
  toggleHabitCompletion,
  toggleRecurringTaskCompletion,
  toggleSingleTaskDone,
  updateCategory,
  updateHabit,
  updateRecurringTask,
  updateSingleTask,
  type CreateCategoryInput,
  type DeleteCriteria,
  type UpdateCategoryPatch,
  type UpdatePatch,
} from "./lib/dataStore";
import { getActiveByok, getActiveStt, getTtsEnabled, type ByokSettings } from "./lib/settingsStore";
import { speak } from "./lib/textToSpeech";
import { emptyAppData, type AppData } from "./types/models";

type Tab = "chat" | "today" | "categories" | "habits" | "single tasks" | "recurring tasks";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

type DeletableItemKind = "singleTask" | "habit" | "recurringTask";

interface PendingDeletion {
  itemKind: DeletableItemKind;
  ids: string[];
  names: string[];
}

// `input` is `unknown` here (not Record<string, unknown>) because callers
// pass response.toolCall, whose `input` is one of AgentToolCall's concrete
// per-tool interfaces (CreateHabitInput, DeleteCriteria, ...) — those don't
// structurally satisfy an index signature. It's narrowed to
// Record<string, unknown> once, inside pushAssistantMessage, to match
// AgentHistoryMessage's shape.
interface ToolCallRef {
  id: string;
  name: string;
  input: unknown;
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

  const [messages, setMessages] = useState<AgentHistoryMessage[]>([]);
  const [sending, setSending] = useState(false);

  const [byok, setByok] = useState<ByokSettings | null>(null);
  const [sttApiKey, setSttApiKey] = useState<string | null>(null);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [activeTab, setActiveTab] = useState<Tab>("chat");
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [pendingDeletion, setPendingDeletion] = useState<PendingDeletion | null>(null);

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

  const prevMessageCountRef = useRef(0);

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

      const folderId = await findOrCreateFolder(newSession);
      const existing = await findDataFile(newSession, folderId);
      if (existing) {
        const loaded = await readDataFile(newSession, existing.fileId);
        const rolled = rolloverPersistentTasks(loaded, todayISO());
        if (rolled !== loaded) {
          try {
            const newRef = await writeDataFile(newSession, existing, rolled);
            setFileRef(newRef);
            setData(rolled);
          } catch {
            // Rollover write failed (conflict, network, etc.) — don't block sign-in over
            // a nice-to-have UI correction; just show the un-rolled-over data this session.
            setFileRef(existing);
            setData(loaded);
          }
        } else {
          setFileRef(existing);
          setData(loaded);
        }
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

  function pushAssistantMessage(content: string, toolCall?: ToolCallRef) {
    setMessages((prev) => {
      if (!toolCall) return [...prev, { role: "assistant", content }];
      // Record the paired tool result too, so the next turn's history to the
      // LLM has a real "I called X with these args and got result Y" record
      // instead of only this paraphrased sentence — see issue #4.
      const input = toolCall.input as Record<string, unknown>;
      return [
        ...prev,
        { role: "assistant", content, toolCall: { id: toolCall.id, name: toolCall.name, input } },
        { role: "tool", toolCallId: toolCall.id, toolName: toolCall.name, result: content },
      ];
    });
  }

  async function handleDeleteRequest(kind: DeletableItemKind, criteria: DeleteCriteria, toolCall: ToolCallRef) {
    if (!data) return;
    const matches =
      kind === "habit"
        ? resolveHabits(data, criteria)
        : kind === "recurringTask"
          ? resolveRecurringTasks(data, criteria)
          : resolveSingleTasks(data, criteria);

    if (matches.length === 0) {
      pushAssistantMessage("I couldn't find anything matching that to delete.", toolCall);
      return;
    }

    const ids = matches.map((match) => match.id);
    const names = matches.map((match) => match.name);

    if (kind === "singleTask" && isNameOnlyCriteria(criteria) && matches.length === 1) {
      const saved = await persist(deleteSingleTasks(data, ids));
      if (saved) pushAssistantMessage(`Deleted "${names[0]}".`, toolCall);
      return;
    }

    setPendingDeletion({ itemKind: kind, ids, names });
    pushAssistantMessage(buildDeleteConfirmationQuestion(kind, names), toolCall);
  }

  async function resolvePendingDeletion(confirmed: boolean, toolCall?: ToolCallRef) {
    const pending = pendingDeletion;
    setPendingDeletion(null);
    if (!pending || !data) return;

    if (!confirmed) {
      pushAssistantMessage("Okay, I won't delete that.", toolCall);
      return;
    }

    const nextData =
      pending.itemKind === "habit"
        ? deleteHabits(data, pending.ids)
        : pending.itemKind === "recurringTask"
          ? deleteRecurringTasks(data, pending.ids)
          : deleteSingleTasks(data, pending.ids);
    const saved = await persist(nextData);
    if (saved) pushAssistantMessage(`Deleted ${formatQuotedList(pending.names)}.`, toolCall);
  }

  function hasAnyPatchField(patch: UpdatePatch): boolean {
    return Object.values(patch).some((value) => value !== undefined);
  }

  async function handleUpdateRequest(
    kind: DeletableItemKind,
    input: { name: string } & UpdatePatch,
    toolCall: ToolCallRef,
    actionVerb: string = "Updated",
  ) {
    if (!data) return;
    const { name: fragment, ...patch } = input;
    const matches =
      kind === "habit"
        ? resolveHabits(data, { name: fragment })
        : kind === "recurringTask"
          ? resolveRecurringTasks(data, { name: fragment })
          : resolveSingleTasks(data, { name: fragment });

    if (matches.length === 0) {
      pushAssistantMessage(`I couldn't find any ${ITEM_NOUNS[kind]} matching "${fragment}".`, toolCall);
      return;
    }
    if (matches.length > 1) {
      pushAssistantMessage(
        `I found more than one ${ITEM_NOUNS[kind]} matching "${fragment}": ${formatQuotedList(matches.map((match) => match.name))}. Which one did you mean?`,
        toolCall,
      );
      return;
    }
    if (!hasAnyPatchField(patch)) {
      pushAssistantMessage("What would you like to change about it?", toolCall);
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
    if (saved) pushAssistantMessage(`${actionVerb} "${target.name}".`, toolCall);
  }

  async function handleSend(userText: string) {
    if (!data) return;
    const nextMessages: AgentHistoryMessage[] = [...messages, { role: "user", content: userText }];
    setMessages(nextMessages);
    setSending(true);
    try {
      const response = await sendMessage(nextMessages, byok, data.categories, pendingDeletion !== null);

      if (pendingDeletion) {
        // Tools were restricted server-side to confirmPendingDeletion only; anything else
        // (a plain reply, no tool call) is treated as a decline — fail closed on a destructive action.
        const confirmTc = response.toolCall?.name === "confirmPendingDeletion" ? response.toolCall : undefined;
        const confirmed = confirmTc?.input.confirmed === true;
        await resolvePendingDeletion(confirmed, confirmTc);
      } else if (response.toolCall?.name === "createSingleTask") {
        const nextData = addSingleTask(data, response.toolCall.input);
        const saved = await persist(nextData);
        if (saved) {
          pushAssistantMessage(`Added "${response.toolCall.input.name}" to your tasks.`, response.toolCall);
        }
      } else if (response.toolCall?.name === "createHabit") {
        const nextData = addHabit(data, response.toolCall.input);
        const saved = await persist(nextData);
        if (saved) {
          pushAssistantMessage(`Added "${response.toolCall.input.name}" as a habit.`, response.toolCall);
        }
      } else if (response.toolCall?.name === "createRecurringTask") {
        const nextData = addRecurringTask(data, response.toolCall.input);
        const saved = await persist(nextData);
        if (saved) {
          pushAssistantMessage(`Added "${response.toolCall.input.name}" as a recurring task.`, response.toolCall);
        }
      } else if (response.toolCall?.name === "deleteSingleTasks") {
        await handleDeleteRequest("singleTask", response.toolCall.input, response.toolCall);
      } else if (response.toolCall?.name === "deleteHabits") {
        await handleDeleteRequest("habit", response.toolCall.input, response.toolCall);
      } else if (response.toolCall?.name === "deleteRecurringTasks") {
        await handleDeleteRequest("recurringTask", response.toolCall.input, response.toolCall);
      } else if (response.toolCall?.name === "updateSingleTask") {
        await handleUpdateRequest("singleTask", response.toolCall.input, response.toolCall);
      } else if (response.toolCall?.name === "updateHabit") {
        await handleUpdateRequest("habit", response.toolCall.input, response.toolCall);
      } else if (response.toolCall?.name === "updateRecurringTask") {
        await handleUpdateRequest("recurringTask", response.toolCall.input, response.toolCall);
      } else if (response.toolCall?.name === "archiveHabit") {
        await handleUpdateRequest(
          "habit",
          { name: response.toolCall.input.name, newEndDate: todayISO() },
          response.toolCall,
          "Archived",
        );
      } else if (response.toolCall?.name === "archiveRecurringTask") {
        await handleUpdateRequest(
          "recurringTask",
          { name: response.toolCall.input.name, newEndDate: todayISO() },
          response.toolCall,
          "Archived",
        );
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

  function handleTaskToggle(taskId: string) {
    if (!data) return;
    void persist(toggleSingleTaskDone(data, taskId));
  }

  function handleHabitToggle(habitId: string) {
    if (!data) return;
    void persist(toggleHabitCompletion(data, habitId, selectedDate));
  }

  function handleRecurringTaskToggle(taskId: string) {
    if (!data) return;
    void persist(toggleRecurringTaskCompletion(data, taskId, selectedDate));
  }

  function handleAddCategory(input: CreateCategoryInput) {
    if (!data) return;
    void persist(addCategory(data, input));
  }

  function handleUpdateCategory(id: string, patch: UpdateCategoryPatch) {
    if (!data) return;
    void persist(updateCategory(data, id, patch));
  }

  function handleDeleteCategory(id: string): boolean {
    if (!data) return false;
    if (isCategoryInUse(data, id)) return false;
    void persist(deleteCategory(data, id));
    return true;
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
        {(["chat", "today", "categories", "habits", "single tasks", "recurring tasks"] as const).map((tab) => (
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
            <DayView
              selectedDate={selectedDate}
              habits={data.habits}
              singleTasks={data.singleTasks}
              recurringTasks={data.recurringTasks}
              completionLog={data.completionLog}
              categories={data.categories}
              onToggleHabit={handleHabitToggle}
              onToggleTask={handleTaskToggle}
              onToggleRecurringTask={handleRecurringTaskToggle}
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

        {activeTab === "habits" && (
          <HabitsView habits={data.habits} categories={data.categories} completionLog={data.completionLog} />
        )}

        {activeTab === "single tasks" && (
          <SingleTasksView singleTasks={data.singleTasks} categories={data.categories} />
        )}

        {activeTab === "recurring tasks" && (
          <RecurringTasksView recurringTasks={data.recurringTasks} categories={data.categories} />
        )}
      </div>
    </div>
  );
}
