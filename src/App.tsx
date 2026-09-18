import { useEffect, useRef, useState } from "react";
import { Settings as SettingsIcon, MessageCircle, Calendar, Tags, List, ChartColumn, Timer as TimerIcon } from "lucide-react";
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
import { formatDurationMinutes } from "./lib/duration";
import {
  signIn,
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
import { sendMessage, AgentRequestError, type AgentHistoryMessage, type AgentToolCall } from "./lib/agentClient";
import { findSameName, parsePick, selectOne, type ItemSelector } from "./lib/itemSelection";
import { loadDebugLog, appendDebugLogEntry, clearDebugLog, type DebugLogEntry } from "./lib/debugLogStore";
import { toDisplayMessages } from "./server/agentHistory";
import {
  addCategory,
  addHabit,
  addRecurringTask,
  addRecurringTaskChecklistItem,
  addSingleTask,
  addSingleTaskChecklistItem,
  bumpSharedKeyMessageCount,
  deleteCategory,
  deleteHabits,
  deleteRecurringTasks,
  deleteSingleTasks,
  isCategoryInUse,
  resolveHabits,
  resolveRecurringTasks,
  resolveSingleTasks,
  rolloverPersistentTasks,
  setHabitChecklistItemChecked,
  setHabitValue,
  SHARED_KEY_MESSAGE_CAP,
  setRecurringTaskChecklistItemChecked,
  setSingleTaskChecklistItemChecked,
  toggleHabitChecklistItem,
  toggleHabitCompletion,
  toggleRecurringTaskChecklistItem,
  toggleRecurringTaskCompletion,
  toggleSingleTaskChecklistItem,
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
import {
  describeArchive,
  describeCandidates,
  describeCreatedHabit,
  describeCreatedRecurringTask,
  describeCreatedSingleTask,
  describeDuplicateQuestion,
  describeItemList,
  describeUpdate,
  formatDate,
  formatGoalMinutes,
} from "./lib/confirmations";
import {
  emptyAppData,
  type AppData,
  type Category,
  type ChecklistItem,
  type Habit,
  type RecurringTask,
  type SingleTask,
} from "./types/models";

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

type DeletableItemKind = "singleTask" | "habit" | "recurringTask";

interface ItemOfKind {
  habit: Habit;
  recurringTask: RecurringTask;
  singleTask: SingleTask;
}

function itemsOf<K extends DeletableItemKind>(data: AppData, kind: K): ItemOfKind[K][] {
  const items = kind === "habit" ? data.habits : kind === "recurringTask" ? data.recurringTasks : data.singleTasks;
  return items as ItemOfKind[K][];
}

function findItem(data: AppData, kind: DeletableItemKind, id: string) {
  return itemsOf(data, kind).find((item) => item.id === id);
}

type CreateToolCall = Extract<AgentToolCall, { name: "createSingleTask" | "createHabit" | "createRecurringTask" }> & {
  id: string;
};

const CREATE_TOOL_KINDS: Record<CreateToolCall["name"], DeletableItemKind> = {
  createSingleTask: "singleTask",
  createHabit: "habit",
  createRecurringTask: "recurringTask",
};

// Both kinds share the same chat-based yes/no resolution (confirmPendingAction):
// a delete always asks first; a create asks only when the name is already in use (§32).
type DispatchableToolCall = AgentToolCall & { id: string };

// §32: the numbered "which one did you mean?" list the app just showed — a reply
// that's only a number ("2", "the first one") reruns `toolCall` on exactly that
// item, resolved in the app without another model call.
interface PendingPick {
  kind: DeletableItemKind;
  itemIds: string[];
  toolCall: DispatchableToolCall;
}

type PendingConfirmation =
  | { type: "delete"; itemKind: DeletableItemKind; ids: string[]; names: string[] }
  | { type: "create"; toolCall: CreateToolCall; userText: string };

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

// Case-insensitive substring match against item text — same style as
// matchesBaseCriteria's name filter in dataStore.ts — used to resolve which
// checklist item a chat request ("check off milk") refers to.
function resolveChecklistItemMatches(checklist: ChecklistItem[] | undefined, fragment: string): ChecklistItem[] {
  const needle = fragment.trim().toLowerCase();
  return (checklist ?? []).filter((item) => item.text.toLowerCase().includes(needle));
}

const ITEM_NOUNS: Record<DeletableItemKind, string> = {
  singleTask: "task",
  habit: "habit",
  recurringTask: "recurring task",
};

function buildDeleteConfirmationQuestion(
  kind: DeletableItemKind,
  items: (Habit | RecurringTask | SingleTask)[],
  categories: Category[],
): string {
  const noun = ITEM_NOUNS[kind];
  const subject =
    items.length === 1
      ? `the ${noun} ${formatQuotedList(items.map((item) => item.name))}?`
      : `these ${items.length} ${noun}s?\n${describeItemList(items, categories, todayISO())}\n`;
  const historyWarning =
    kind !== "singleTask"
      ? items.length === 1
        ? " This will also permanently delete its tracked completion history."
        : "This will also permanently delete their tracked completion history."
      : "";
  return `Are you sure you want to delete ${subject}${historyWarning}`.trimEnd();
}

/** Item types an update patch can apply to — e.g. newTarget only makes sense on a habit, newDone only on a one-off task. */
function updateKindsFor(patch: UpdatePatch, isArchive: boolean): DeletableItemKind[] {
  const habitOnly = [patch.newCompletionType, patch.newChecklistItems, patch.newTarget, patch.newUnit].some(
    (value) => value !== undefined,
  );
  const singleTaskOnly = patch.newDone !== undefined || patch.newPersistency !== undefined;
  const recurringOnly = patch.newRecurrence !== undefined || isArchive;
  if (habitOnly) return singleTaskOnly ? [] : ["habit"];
  if (singleTaskOnly) return recurringOnly ? [] : ["singleTask"];
  return recurringOnly ? ["habit", "recurringTask"] : ["habit", "recurringTask", "singleTask"];
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
  // §27 in Roadmap.md: hoisted here (not local to Settings.tsx) so the debug
  // log panel updates live while it's open during a chat turn, instead of
  // only reflecting a one-time snapshot taken when it was unlocked.
  const [debugLog, setDebugLog] = useState<DebugLogEntry[]>(() => loadDebugLog());

  const [activeTab, setActiveTab] = useState<Tab>("chat");
  const [viewSubTab, setViewSubTab] = useState<ViewSubTab>("habits");
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [pendingPick, setPendingPick] = useState<PendingPick | null>(null);
  // Set only while rerunning a picked action, so pickItem returns that exact item.
  const forcedPickRef = useRef<{ kind: DeletableItemKind; id: string } | null>(null);

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

  /**
   * Takes the mutation itself (not a precomputed AppData) so that on a write conflict it can
   * be replayed against freshly reloaded remote data — see §21 in Roadmap.md. Two attempts
   * total: attempt 1 against this render's `data`; on a conflict, reload remote data and
   * replay `mutate` against it for attempt 2. Returns whether the save actually succeeded, so
   * callers don't confirm an action that didn't happen.
   */
  async function persist(mutate: (data: AppData) => AppData): Promise<boolean> {
    attemptedWriteRef.current = true;
    if (!session || !fileRef || !data) return false;

    let baseData = data;
    let ref = fileRef;

    for (let attempt = 1; attempt <= 2; attempt++) {
      const toWrite = pendingSharedKeyBumpRef.current ? bumpSharedKeyMessageCount(mutate(baseData)) : mutate(baseData);
      try {
        const newRef = await writeDataFile(session, ref, toWrite);
        setFileRef(newRef);
        setData(toWrite);
        pendingSharedKeyBumpRef.current = false;
        return true;
      } catch (err) {
        if (err instanceof DriveConflictError && attempt === 1) {
          try {
            baseData = await readDataFile(session, ref.fileId);
            ref = { fileId: ref.fileId, modifiedTime: err.currentModifiedTime };
          } catch (reloadErr) {
            pushAssistantMessage(
              reloadErr instanceof DriveOfflineError
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
      const saved = await persist((current) => deleteSingleTasks(current, ids));
      if (saved) pushAssistantMessage(`Deleted "${names[0]}".`, toolCall);
      return;
    }

    setPendingConfirmation({ type: "delete", itemKind: kind, ids, names });
    pushAssistantMessage(buildDeleteConfirmationQuestion(kind, matches, data.categories), toolCall);
  }

  async function resolvePendingConfirmation(confirmed: boolean, toolCall?: ToolCallRef) {
    const pending = pendingConfirmation;
    setPendingConfirmation(null);
    if (!pending || !data) return;

    if (pending.type === "create") {
      if (confirmed && toolCall) {
        await handleCreateRequest(pending.toolCall, pending.userText, { confirmedDuplicate: true, replyTo: toolCall });
      } else {
        pushAssistantMessage("Okay, I didn't create it.", toolCall);
      }
      return;
    }

    if (!confirmed) {
      pushAssistantMessage("Okay, I won't delete that.", toolCall);
      return;
    }

    const saved = await persist((current) =>
      pending.itemKind === "habit"
        ? deleteHabits(current, pending.ids)
        : pending.itemKind === "recurringTask"
          ? deleteRecurringTasks(current, pending.ids)
          : deleteSingleTasks(current, pending.ids),
    );
    if (saved) pushAssistantMessage(`Deleted ${formatQuotedList(pending.names)}.`, toolCall);
  }

  function hasAnyPatchField(patch: UpdatePatch): boolean {
    return Object.values(patch).some((value) => value !== undefined);
  }

  async function handleUpdateRequest(
    requestedKind: DeletableItemKind,
    input: ItemSelector & UpdatePatch,
    toolCall: ToolCallRef,
    actionVerb: string = "Updated",
  ) {
    if (!data) return;
    // categoryId is the §32 selector (which item), never a field to change — that's newCategoryId.
    const { name, categoryId, ...patch } = input;
    const kind = resolveKind(requestedKind, updateKindsFor(patch, actionVerb === "Archived"), { name, categoryId });
    const target = pickItem(kind, { name, categoryId }, toolCall);
    if (!target) return;
    if (!hasAnyPatchField(patch)) {
      pushAssistantMessage("What would you like to change about it?", toolCall);
      return;
    }

    // §31: capture before/after inside the mutator so a §21 conflict-replay
    // describes what was actually written, not this render's stale copy.
    let before: Habit | RecurringTask | SingleTask | undefined;
    let after: Habit | RecurringTask | SingleTask | undefined;
    const saved = await persist((current) => {
      const next =
        kind === "habit"
          ? updateHabit(current, target.id, patch)
          : kind === "recurringTask"
            ? updateRecurringTask(current, target.id, patch)
            : updateSingleTask(current, target.id, patch);
      before = findItem(current, kind, target.id);
      after = findItem(next, kind, target.id);
      return next;
    });
    if (!saved) return;
    if (!before || !after) {
      pushAssistantMessage(`${actionVerb} "${target.name}".`, toolCall);
    } else if (actionVerb === "Archived") {
      pushAssistantMessage(describeArchive(after), toolCall);
    } else {
      pushAssistantMessage(describeUpdate(before, after, data.categories, todayISO()), toolCall);
    }
  }

  // §32: the model can't see the user's data, so it can guess the wrong item type (e.g.
  // updateRecurringTask for what's really a habit). If the requested type has no match,
  // use the first of `alternatives` (types that can take the same action) that does.
  // During a number-pick rerun, the picked item's own type wins.
  function resolveKind(
    requested: DeletableItemKind,
    alternatives: DeletableItemKind[],
    selector: ItemSelector,
  ): DeletableItemKind {
    const forced = forcedPickRef.current;
    if (forced && (forced.kind === requested || alternatives.includes(forced.kind))) return forced.kind;
    if (!data) return requested;
    const hasMatch = (kind: DeletableItemKind) => selectOne(itemsOf(data, kind), selector).kind !== "none";
    if (hasMatch(requested)) return requested;
    return alternatives.find((kind) => kind !== requested && hasMatch(kind)) ?? requested;
  }

  // §32: the one place single-item chat actions (update/archive/log/checklist) resolve which
  // item the user means. Pushes the "not found" / "which one?" reply itself and returns null
  // in those cases, so callers just bail out.
  function pickItem<K extends DeletableItemKind>(
    kind: K,
    selector: ItemSelector,
    toolCall: ToolCallRef,
    canTakeAction?: (item: ItemOfKind[K]) => boolean,
    ineligibleMessage?: (items: ItemOfKind[K][]) => string,
  ): ItemOfKind[K] | null {
    if (!data) return null;
    const noun = ITEM_NOUNS[kind];

    const forced = forcedPickRef.current;
    if (forced && forced.kind === kind) {
      forcedPickRef.current = null;
      const item = itemsOf(data, kind).find((candidate) => candidate.id === forced.id);
      if (item && (!canTakeAction || canTakeAction(item))) return item;
      pushAssistantMessage(`That ${noun} doesn't seem to exist anymore.`, toolCall);
      return null;
    }

    const selection = selectOne(itemsOf(data, kind), selector, canTakeAction);
    switch (selection.kind) {
      case "one":
        return selection.item;
      case "none": {
        const category = data.categories.find((c) => c.id === selector.categoryId);
        pushAssistantMessage(
          `I couldn't find any ${noun} matching "${selector.name}"${category ? ` in ${category.name}` : ""}.`,
          toolCall,
        );
        return null;
      }
      case "ineligible":
        pushAssistantMessage(ineligibleMessage?.(selection.items) ?? `I couldn't find a matching ${noun} for that.`, toolCall);
        return null;
      case "many":
        setPendingPick({
          kind,
          itemIds: selection.items.map((item) => item.id),
          toolCall: toolCall as DispatchableToolCall,
        });
        pushAssistantMessage(describeCandidates(noun, selector.name, selection.items, data.categories, todayISO()), toolCall);
        return null;
    }
  }

  // §31 + §32: creates the item and replies with what was stored — unless the name is already
  // in use, in which case nothing is created until the user confirms (resolvePendingConfirmation
  // calls back in with confirmedDuplicate, replying under the confirmation's own tool call).
  async function handleCreateRequest(
    toolCall: CreateToolCall,
    userText: string,
    options: { confirmedDuplicate?: boolean; replyTo?: ToolCallRef } = {},
  ) {
    if (!data) return;
    const kind = CREATE_TOOL_KINDS[toolCall.name];
    const replyTo = options.replyTo ?? toolCall;

    if (!options.confirmedDuplicate) {
      const existing = findSameName<Habit | RecurringTask | SingleTask>(itemsOf(data, kind), toolCall.input.name, todayISO());
      if (existing.length > 0) {
        setPendingConfirmation({ type: "create", toolCall, userText });
        pushAssistantMessage(
          describeDuplicateQuestion(ITEM_NOUNS[kind], toolCall.input.name, existing, data.categories, todayISO()),
          toolCall,
        );
        return;
      }
    }

    // Each add* appends, so the stored item is the new array's last element.
    if (toolCall.name === "createSingleTask") {
      let created: SingleTask | undefined;
      const saved = await persist((current) => {
        const next = addSingleTask(current, toolCall.input);
        created = next.singleTasks[next.singleTasks.length - 1];
        return next;
      });
      if (saved && created) pushAssistantMessage(describeCreatedSingleTask(created, toolCall.input, todayISO()), replyTo);
    } else if (toolCall.name === "createHabit") {
      let created: Habit | undefined;
      const saved = await persist((current) => {
        const next = addHabit(current, toolCall.input);
        created = next.habits[next.habits.length - 1];
        return next;
      });
      if (saved && created) {
        pushAssistantMessage(describeCreatedHabit(created, toolCall.input, data.categories, userText, todayISO()), replyTo);
      }
    } else {
      let created: RecurringTask | undefined;
      const saved = await persist((current) => {
        const next = addRecurringTask(current, toolCall.input);
        created = next.recurringTasks[next.recurringTasks.length - 1];
        return next;
      });
      if (saved && created) {
        pushAssistantMessage(
          describeCreatedRecurringTask(created, toolCall.input, data.categories, userText, todayISO()),
          replyTo,
        );
      }
    }
  }

  // Carries out a tool call the model chose — or, for a §32 number pick, the
  // original tool call rerun with forcedPickRef set.
  async function dispatchToolCall(toolCall: DispatchableToolCall, userText: string) {
    if (
      toolCall.name === "createSingleTask" ||
      toolCall.name === "createHabit" ||
      toolCall.name === "createRecurringTask"
    ) {
      await handleCreateRequest(toolCall, userText);
    } else if (toolCall.name === "deleteSingleTasks") {
      await handleDeleteRequest("singleTask", toolCall.input, toolCall);
    } else if (toolCall.name === "deleteHabits") {
      await handleDeleteRequest("habit", toolCall.input, toolCall);
    } else if (toolCall.name === "deleteRecurringTasks") {
      await handleDeleteRequest("recurringTask", toolCall.input, toolCall);
    } else if (toolCall.name === "updateSingleTask") {
      await handleUpdateRequest("singleTask", toolCall.input, toolCall);
    } else if (toolCall.name === "updateHabit") {
      await handleUpdateRequest("habit", toolCall.input, toolCall);
    } else if (toolCall.name === "updateRecurringTask") {
      await handleUpdateRequest("recurringTask", toolCall.input, toolCall);
    } else if (toolCall.name === "archiveHabit") {
      await handleUpdateRequest(
        "habit",
        { name: toolCall.input.name, categoryId: toolCall.input.categoryId, newEndDate: todayISO() },
        toolCall,
        "Archived",
      );
    } else if (toolCall.name === "archiveRecurringTask") {
      await handleUpdateRequest(
        "recurringTask",
        { name: toolCall.input.name, categoryId: toolCall.input.categoryId, newEndDate: todayISO() },
        toolCall,
        "Archived",
      );
    } else if (toolCall.name === "logHabitProgress") {
      await handleLogHabitProgress(toolCall.input, toolCall);
    } else if (toolCall.name === "addRecurringTaskChecklistItem") {
      await handleAddTaskChecklistItemChat("recurringTask", toolCall.input, toolCall);
    } else if (toolCall.name === "addSingleTaskChecklistItem") {
      await handleAddTaskChecklistItemChat("singleTask", toolCall.input, toolCall);
    } else if (toolCall.name === "checkHabitChecklistItem") {
      await handleCheckHabitChecklistItem(toolCall.input, toolCall);
    } else if (toolCall.name === "checkRecurringTaskChecklistItem") {
      await handleCheckTaskChecklistItem("recurringTask", toolCall.input, toolCall);
    } else if (toolCall.name === "checkSingleTaskChecklistItem") {
      await handleCheckTaskChecklistItem("singleTask", toolCall.input, toolCall);
    }
  }

  // §32: a bare number reply to the last "which one?" list. Returns true if it handled
  // the message (no model call, so no shared-trial message is used up).
  async function handlePickReply(userText: string): Promise<boolean> {
    const pick = pendingPick;
    if (!pick) return false;
    const index = parsePick(userText, pick.itemIds.length);
    if (index === null) return false;

    setMessages((prev) => [...prev, { role: "user", content: userText }]);
    if (index < 1 || index > pick.itemIds.length) {
      pushAssistantMessage(`Please pick a number from 1 to ${pick.itemIds.length}.`);
      return true;
    }
    setPendingPick(null);
    forcedPickRef.current = { kind: pick.kind, id: pick.itemIds[index - 1] };
    attemptedWriteRef.current = false;
    setSending(true);
    try {
      // Fresh id: the original call is already paired with its "which one?" result in history.
      await dispatchToolCall({ ...pick.toolCall, id: crypto.randomUUID() }, userText);
    } finally {
      forcedPickRef.current = null;
      setSending(false);
    }
    return true;
  }

  async function handleSend(userText: string) {
    if (!data) return;
    if (!pendingConfirmation && (await handlePickReply(userText))) return;
    // Any other message moves on from the list; a new "which one?" can set it again below.
    setPendingPick(null);

    const usingSharedKey = !byok;
    // Skip the gate while a confirmation is outstanding — it only has a chat-based
    // confirm/decline path, so blocking it here would leave it stuck with no way to resolve.
    if (usingSharedKey && !pendingConfirmation && (data.sharedKeyMessageCount ?? 0) >= SHARED_KEY_MESSAGE_CAP) {
      setMessages((prev) => [...prev, { role: "user", content: userText }]);
      pushAssistantMessage(
        `You've used all ${SHARED_KEY_MESSAGE_CAP} free trial messages. Open Settings (⚙) and add your own free Groq or Gemini key — ` +
          "it takes about a minute. Step-by-step guide: /api-key-setup.html",
      );
      return;
    }

    const nextMessages: AgentHistoryMessage[] = [...messages, { role: "user", content: userText }];
    setMessages(nextMessages);
    setSending(true);
    pendingSharedKeyBumpRef.current = usingSharedKey;
    attemptedWriteRef.current = false;
    try {
      const response = await sendMessage(nextMessages, byok, data.categories, pendingConfirmation !== null);
      if (response.debug) recordDebugEntry(response.debug);

      if (pendingConfirmation) {
        // Tools were restricted server-side to confirmPendingAction only; anything else
        // (a plain reply, no tool call) is treated as a decline — fail closed.
        const confirmTc = response.toolCall?.name === "confirmPendingAction" ? response.toolCall : undefined;
        const confirmed = confirmTc?.input.confirmed === true;
        await resolvePendingConfirmation(confirmed, confirmTc);
      } else if (response.toolCall) {
        await dispatchToolCall(response.toolCall, userText);
      } else if (response.reply) {
        pushAssistantMessage(response.reply);
      } else {
        pushAssistantMessage("I didn't get a usable response — try rephrasing?");
      }

      // No branch above persisted this turn (e.g. a plain reply, or a "couldn't find a
      // match" message) — flush the pending shared-key count on its own so it isn't lost.
      if (pendingSharedKeyBumpRef.current && !attemptedWriteRef.current) {
        await persist((current) => current);
      }
    } catch (err) {
      if (err instanceof AgentRequestError && err.debug) recordDebugEntry(err.debug);
      pushAssistantMessage(err instanceof Error ? err.message : "Something went wrong talking to the assistant.");
      // pendingConfirmation is deliberately left untouched here — only a real
      // response (or explicit decline) clears it, so a transient network
      // failure while awaiting confirmation doesn't silently drop it.
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

  function handleHabitToggle(habitId: string) {
    if (!data) return;
    void persist((current) => toggleHabitCompletion(current, habitId, selectedDate));
  }

  function handleRecurringTaskToggle(taskId: string) {
    if (!data) return;
    void persist((current) => toggleRecurringTaskCompletion(current, taskId, selectedDate));
  }

  function handleHabitChecklistToggle(habitId: string, itemId: string, dateISO: string) {
    if (!data) return;
    void persist((current) => toggleHabitChecklistItem(current, habitId, itemId, dateISO));
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

  async function handleLogHabitProgress(
    input: ItemSelector & { date?: string; value?: number; delta?: number },
    toolCall: ToolCallRef,
  ) {
    if (!data) return;
    // §32: only number/timer habits can take a logged value, so a same-named yes/no habit
    // never makes this ambiguous.
    const habit = pickItem(
      "habit",
      input,
      toolCall,
      (candidate) => candidate.completionType === "value" || candidate.completionType === "timer",
      (candidates) =>
        candidates.length === 1
          ? `"${candidates[0].name}" isn't tracked with a number or timer, so there's nothing to log.`
          : `None of the habits matching "${input.name}" are tracked with a number or timer, so there's nothing to log.`,
    );
    if (!habit) return;
    const dateISO = input.date ?? todayISO();
    // Recompute inside the mutator (not before persist()) so a delta re-derives against
    // whatever data a conflict-replay actually reloads, rather than replaying a stale
    // absolute value computed from this render's now-outdated `data` — see §21.
    let loggedValue = 0;
    const saved = await persist((latest) => {
      const currentValue = latest.completionLog.find((entry) => entry.itemId === habit.id && entry.date === dateISO)?.value ?? 0;
      loggedValue = input.value !== undefined ? input.value : currentValue + (input.delta ?? 0);
      return setHabitValue(latest, habit.id, dateISO, loggedValue);
    });
    if (saved) {
      const loggedText =
        habit.completionType === "timer"
          ? formatDurationMinutes(loggedValue)
          : `${loggedValue}${habit.unit ? ` ${habit.unit}` : ""}`;
      const goalText =
        habit.target && habit.target > 0
          ? ` — ${Math.round((loggedValue / habit.target) * 100)}% of your ${habit.completionType === "timer" ? formatGoalMinutes(habit.target) : `${habit.target}${habit.unit ? ` ${habit.unit}` : ""}`} goal`
          : "";
      const dateText = dateISO === todayISO() ? "today" : `on ${formatDate(dateISO, todayISO())}`;
      pushAssistantMessage(`Logged ${loggedText} for "${habit.name}" ${dateText}${goalText}.`, toolCall);
    }
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

  // Recurring and one-off tasks share these: the model may guess the wrong task type (§32).
  async function handleAddTaskChecklistItemChat(
    requestedKind: "recurringTask" | "singleTask",
    input: ItemSelector & { text: string },
    toolCall: ToolCallRef,
  ) {
    const kind = resolveKind(requestedKind, ["recurringTask", "singleTask"], input) as "recurringTask" | "singleTask";
    const task = pickItem(kind, input, toolCall);
    if (!task) return;
    const saved = await persist((current) =>
      kind === "recurringTask"
        ? addRecurringTaskChecklistItem(current, task.id, input.text)
        : addSingleTaskChecklistItem(current, task.id, input.text),
    );
    if (saved) pushAssistantMessage(`Added "${input.text}" to "${task.name}".`, toolCall);
  }

  async function handleCheckHabitChecklistItem(
    input: ItemSelector & { item: string; checked?: boolean; date?: string },
    toolCall: ToolCallRef,
  ) {
    const habit = pickItem(
      "habit",
      input,
      toolCall,
      (candidate) => candidate.completionType === "checklist",
      (candidates) =>
        candidates.length === 1
          ? `"${candidates[0].name}" isn't tracked with a checklist.`
          : `None of the habits matching "${input.name}" are tracked with a checklist.`,
    );
    if (!habit) return;
    const itemMatches = resolveChecklistItemMatches(habit.checklist, input.item);
    if (itemMatches.length === 0) {
      pushAssistantMessage(`I couldn't find a checklist item matching "${input.item}" on "${habit.name}".`, toolCall);
      return;
    }
    if (itemMatches.length > 1) {
      pushAssistantMessage(
        `I found more than one checklist item matching "${input.item}" on "${habit.name}": ${formatQuotedList(itemMatches.map((item) => item.text))}. Which one did you mean?`,
        toolCall,
      );
      return;
    }
    const checked = input.checked ?? true;
    const dateISO = input.date ?? todayISO();
    const saved = await persist((current) =>
      setHabitChecklistItemChecked(current, habit.id, itemMatches[0].id, checked, dateISO),
    );
    if (saved) {
      pushAssistantMessage(`${checked ? "Checked off" : "Unchecked"} "${itemMatches[0].text}" on "${habit.name}".`, toolCall);
    }
  }

  async function handleCheckTaskChecklistItem(
    requestedKind: "recurringTask" | "singleTask",
    input: ItemSelector & { item: string; checked?: boolean },
    toolCall: ToolCallRef,
  ) {
    const kind = resolveKind(requestedKind, ["recurringTask", "singleTask"], input) as "recurringTask" | "singleTask";
    const task = pickItem(kind, input, toolCall);
    if (!task) return;
    const itemMatches = resolveChecklistItemMatches(task.checklist, input.item);
    if (itemMatches.length === 0) {
      pushAssistantMessage(`I couldn't find a checklist item matching "${input.item}" on "${task.name}".`, toolCall);
      return;
    }
    if (itemMatches.length > 1) {
      pushAssistantMessage(
        `I found more than one checklist item matching "${input.item}" on "${task.name}": ${formatQuotedList(itemMatches.map((item) => item.text))}. Which one did you mean?`,
        toolCall,
      );
      return;
    }
    const checked = input.checked ?? true;
    const saved = await persist((current) =>
      kind === "recurringTask"
        ? setRecurringTaskChecklistItemChecked(current, task.id, itemMatches[0].id, checked)
        : setSingleTaskChecklistItemChecked(current, task.id, itemMatches[0].id, checked),
    );
    if (saved) {
      pushAssistantMessage(`${checked ? "Checked off" : "Unchecked"} "${itemMatches[0].text}" on "${task.name}".`, toolCall);
    }
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
        <button
          onClick={() => setSettingsOpen((open) => !open)}
          className="rounded-md bg-slate-800 p-2 hover:bg-slate-700"
          aria-label="Settings"
        >
          <SettingsIcon className="h-4 w-4" />
        </button>
      </div>

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
              habits={data.habits}
              singleTasks={data.singleTasks}
              recurringTasks={data.recurringTasks}
              completionLog={data.completionLog}
              categories={data.categories}
              onToggleHabit={handleHabitToggle}
              onToggleTask={handleTaskToggle}
              onToggleRecurringTask={handleRecurringTaskToggle}
              onToggleHabitChecklistItem={(habitId, itemId) => handleHabitChecklistToggle(habitId, itemId, selectedDate)}
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
