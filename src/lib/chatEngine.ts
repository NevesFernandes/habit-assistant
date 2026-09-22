// §33 in Roadmap.md: everything that happens in a chat turn after the user
// hits send — calling the agent, carrying out the tool call it chose against
// AppData, the "which one did you mean?" / confirmation follow-ups, and the
// reply text — with no React or Google Drive in it. App.tsx drives one
// ChatSession with the real Drive persist and HTTP agent call; the headless
// chat-scenario tests (tests/chat/) drive the exact same code with an
// in-memory persist and a direct handleAgentRequest call, so a passing
// scenario means the real app behaves the same way.
import { AgentRequestError, type AgentHistoryMessage, type AgentResponse, type AgentToolCall } from "./agentClient";
import type { AgentDebugEntry } from "../server/handleAgentRequest";
import { findSameName, parsePick, selectOne, type ItemSelector } from "./itemSelection";
import { formatDurationMinutes } from "./duration";
import {
  addHabit,
  addRecurringTask,
  addRecurringTaskChecklistItem,
  addSingleTask,
  addSingleTaskChecklistItem,
  deleteHabits,
  deleteRecurringTasks,
  deleteSingleTasks,
  resolveHabits,
  resolveRecurringTasks,
  resolveSingleTasks,
  setHabitChecklistItemChecked,
  setHabitValue,
  setRecurringTaskChecklistItemChecked,
  setSingleTaskChecklistItemChecked,
  updateHabit,
  updateRecurringTask,
  updateSingleTask,
  type DeleteCriteria,
  type UpdatePatch,
} from "./dataStore";
import {
  describeArchive,
  describeCandidates,
  describeCreatedHabit,
  describeCreatedRecurringTask,
  describeCreatedSingleTask,
  describeDuplicateQuestion,
  describeFutureTaskQuestion,
  describeItemList,
  describeUpdate,
  formatDate,
  formatGoalMinutes,
} from "./confirmations";
import { isFutureDate } from "./recurrence";
import type { AppData, Category, ChecklistItem, Habit, RecurringTask, SingleTask } from "../types/models";

export type ItemKind = "singleTask" | "habit" | "recurringTask";

interface ItemOfKind {
  habit: Habit;
  recurringTask: RecurringTask;
  singleTask: SingleTask;
}

function itemsOf<K extends ItemKind>(data: AppData, kind: K): ItemOfKind[K][] {
  const items = kind === "habit" ? data.habits : kind === "recurringTask" ? data.recurringTasks : data.singleTasks;
  return items as ItemOfKind[K][];
}

function findItem(data: AppData, kind: ItemKind, id: string) {
  return itemsOf(data, kind).find((item) => item.id === id);
}

type DispatchableToolCall = AgentToolCall & { id: string };

type CreateToolCall = Extract<AgentToolCall, { name: "createSingleTask" | "createHabit" | "createRecurringTask" }> & {
  id: string;
};

const CREATE_TOOL_KINDS: Record<CreateToolCall["name"], ItemKind> = {
  createSingleTask: "singleTask",
  createHabit: "habit",
  createRecurringTask: "recurringTask",
};

// §32: the numbered "which one did you mean?" list just shown — a reply that's
// only a number ("2", "the first one") reruns `toolCall` on exactly that item,
// resolved here without another model call.
interface PendingPick {
  kind: ItemKind;
  itemIds: string[];
  toolCall: DispatchableToolCall;
}

// Both kinds share the same chat-based yes/no resolution (confirmPendingAction):
// a delete always asks first; a create asks only when the name is already in use (§32).
export type PendingConfirmation =
  | { type: "delete"; itemKind: ItemKind; ids: string[]; names: string[] }
  | { type: "create"; toolCall: CreateToolCall; userText: string }
  // §29: completing a future-dated one-off task, which also moves it to today.
  | { type: "completeFutureTask"; taskId: string; name: string; startDate: string; patch: UpdatePatch };

// `input` is `unknown` here (not Record<string, unknown>) because callers
// pass a tool call whose `input` is one of AgentToolCall's concrete per-tool
// interfaces (CreateHabitInput, DeleteCriteria, ...) — those don't
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

const ITEM_NOUNS: Record<ItemKind, string> = {
  singleTask: "task",
  habit: "habit",
  recurringTask: "recurring task",
};

function buildDeleteConfirmationQuestion(
  kind: ItemKind,
  items: (Habit | RecurringTask | SingleTask)[],
  categories: Category[],
  todayISO: string,
): string {
  const noun = ITEM_NOUNS[kind];
  const subject =
    items.length === 1
      ? `the ${noun} ${formatQuotedList(items.map((item) => item.name))}?`
      : `these ${items.length} ${noun}s?\n${describeItemList(items, categories, todayISO)}\n`;
  const historyWarning =
    kind !== "singleTask"
      ? items.length === 1
        ? " This will also permanently delete its tracked completion history."
        : "This will also permanently delete their tracked completion history."
      : "";
  return `Are you sure you want to delete ${subject}${historyWarning}`.trimEnd();
}

/** Item types an update patch can apply to — e.g. newTarget only makes sense on a habit, newDone only on a one-off task. */
function updateKindsFor(patch: UpdatePatch, isArchive: boolean): ItemKind[] {
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

function hasAnyPatchField(patch: UpdatePatch): boolean {
  return Object.values(patch).some((value) => value !== undefined);
}

export interface ChatEngineDeps {
  /** The latest AppData (null before sign-in). */
  getData(): AppData | null;
  /** Applies and saves a mutation; resolves to whether it actually saved. */
  persist(mutate: (data: AppData) => AppData): Promise<boolean>;
  callAgent(
    messages: AgentHistoryMessage[],
    categories: Category[],
    hasPendingConfirmation: boolean,
  ): Promise<AgentResponse>;
  todayISO(): string;
  onDebug?(entry: AgentDebugEntry): void;
  /** Called whenever `messages` changes. */
  onChange?(): void;
  /**
   * Called right before a message is sent to the model (never for a §32 number pick,
   * which is resolved locally). Return a reply to show instead of calling the model —
   * e.g. the §20 shared-trial cap — or null to go ahead.
   */
  beforeModelCall?(context: { hasPendingConfirmation: boolean }): string | null;
}

export class ChatSession {
  messages: AgentHistoryMessage[] = [];
  pendingConfirmation: PendingConfirmation | null = null;
  pendingPick: PendingPick | null = null;
  // Set only while rerunning a picked action, so pickItem returns that exact item.
  private forcedPick: { kind: ItemKind; id: string } | null = null;
  private readonly deps: ChatEngineDeps;

  constructor(deps: ChatEngineDeps) {
    this.deps = deps;
  }

  private get todayISO(): string {
    return this.deps.todayISO();
  }

  private append(...entries: AgentHistoryMessage[]) {
    this.messages = [...this.messages, ...entries];
    this.deps.onChange?.();
  }

  pushAssistantMessage(content: string, toolCall?: ToolCallRef) {
    if (!toolCall) {
      this.append({ role: "assistant", content });
      return;
    }
    // Record the paired tool result too, so the next turn's history to the
    // LLM has a real "I called X with these args and got result Y" record
    // instead of only this paraphrased sentence — see issue #4.
    const input = toolCall.input as Record<string, unknown>;
    this.append(
      { role: "assistant", content, toolCall: { id: toolCall.id, name: toolCall.name, input } },
      { role: "tool", toolCallId: toolCall.id, toolName: toolCall.name, result: content },
    );
  }

  /** One user turn. Resolves once every reply for it has been pushed. */
  async send(userText: string): Promise<void> {
    const data = this.deps.getData();
    if (!data) return;
    if (!this.pendingConfirmation && (await this.handlePickReply(userText))) return;
    // Any other message moves on from the list; a new "which one?" can set it again below.
    this.pendingPick = null;

    const pendingConfirmation = this.pendingConfirmation;
    const blocked = this.deps.beforeModelCall?.({ hasPendingConfirmation: pendingConfirmation !== null }) ?? null;
    if (blocked !== null) {
      this.append({ role: "user", content: userText });
      this.pushAssistantMessage(blocked);
      return;
    }

    this.append({ role: "user", content: userText });
    try {
      const response = await this.deps.callAgent(this.messages, data.categories, pendingConfirmation !== null);
      if (response.debug) this.deps.onDebug?.(response.debug);

      if (pendingConfirmation) {
        // Tools were restricted server-side to confirmPendingAction only; anything else
        // (a plain reply, no tool call) is treated as a decline — fail closed.
        const confirmTc = response.toolCall?.name === "confirmPendingAction" ? response.toolCall : undefined;
        const confirmed = confirmTc?.input.confirmed === true;
        await this.resolvePendingConfirmation(confirmed, confirmTc);
      } else if (response.toolCall) {
        await this.dispatchToolCall(response.toolCall, userText);
      } else if (response.reply) {
        this.pushAssistantMessage(response.reply);
      } else {
        this.pushAssistantMessage("I didn't get a usable response — try rephrasing?");
      }
    } catch (err) {
      if (err instanceof AgentRequestError && err.debug) this.deps.onDebug?.(err.debug);
      this.pushAssistantMessage(err instanceof Error ? err.message : "Something went wrong talking to the assistant.");
      // pendingConfirmation is deliberately left untouched here — only a real
      // response (or explicit decline) clears it, so a transient network
      // failure while awaiting confirmation doesn't silently drop it.
    }
  }

  // §32: a bare number reply to the last "which one?" list. Returns true if it handled
  // the message (no model call, so no shared-trial message is used up).
  private async handlePickReply(userText: string): Promise<boolean> {
    const pick = this.pendingPick;
    if (!pick) return false;
    const index = parsePick(userText, pick.itemIds.length);
    if (index === null) return false;

    this.append({ role: "user", content: userText });
    if (index < 1 || index > pick.itemIds.length) {
      this.pushAssistantMessage(`Please pick a number from 1 to ${pick.itemIds.length}.`);
      return true;
    }
    this.pendingPick = null;
    this.forcedPick = { kind: pick.kind, id: pick.itemIds[index - 1] };
    try {
      // Fresh id: the original call is already paired with its "which one?" result in history.
      await this.dispatchToolCall({ ...pick.toolCall, id: crypto.randomUUID() }, userText);
    } finally {
      this.forcedPick = null;
    }
    return true;
  }

  // Carries out a tool call the model chose — or, for a §32 number pick, the
  // original tool call rerun with forcedPick set.
  private async dispatchToolCall(toolCall: DispatchableToolCall, userText: string) {
    const today = this.todayISO;
    if (
      toolCall.name === "createSingleTask" ||
      toolCall.name === "createHabit" ||
      toolCall.name === "createRecurringTask"
    ) {
      await this.handleCreateRequest(toolCall, userText);
    } else if (toolCall.name === "deleteSingleTasks") {
      await this.handleDeleteRequest("singleTask", toolCall.input, toolCall);
    } else if (toolCall.name === "deleteHabits") {
      await this.handleDeleteRequest("habit", toolCall.input, toolCall);
    } else if (toolCall.name === "deleteRecurringTasks") {
      await this.handleDeleteRequest("recurringTask", toolCall.input, toolCall);
    } else if (toolCall.name === "updateSingleTask") {
      await this.handleUpdateRequest("singleTask", toolCall.input, toolCall);
    } else if (toolCall.name === "updateHabit") {
      await this.handleUpdateRequest("habit", toolCall.input, toolCall);
    } else if (toolCall.name === "updateRecurringTask") {
      await this.handleUpdateRequest("recurringTask", toolCall.input, toolCall);
    } else if (toolCall.name === "archiveHabit") {
      await this.handleUpdateRequest(
        "habit",
        { name: toolCall.input.name, categoryId: toolCall.input.categoryId, newEndDate: today },
        toolCall,
        "Archived",
      );
    } else if (toolCall.name === "archiveRecurringTask") {
      await this.handleUpdateRequest(
        "recurringTask",
        { name: toolCall.input.name, categoryId: toolCall.input.categoryId, newEndDate: today },
        toolCall,
        "Archived",
      );
    } else if (toolCall.name === "logHabitProgress") {
      await this.handleLogHabitProgress(toolCall.input, toolCall);
    } else if (toolCall.name === "addRecurringTaskChecklistItem") {
      await this.handleAddTaskChecklistItem("recurringTask", toolCall.input, toolCall);
    } else if (toolCall.name === "addSingleTaskChecklistItem") {
      await this.handleAddTaskChecklistItem("singleTask", toolCall.input, toolCall);
    } else if (toolCall.name === "checkHabitChecklistItem") {
      await this.handleCheckHabitChecklistItem(toolCall.input, toolCall);
    } else if (toolCall.name === "checkRecurringTaskChecklistItem") {
      await this.handleCheckTaskChecklistItem("recurringTask", toolCall.input, toolCall);
    } else if (toolCall.name === "checkSingleTaskChecklistItem") {
      await this.handleCheckTaskChecklistItem("singleTask", toolCall.input, toolCall);
    }
  }

  private async handleDeleteRequest(kind: ItemKind, criteria: DeleteCriteria, toolCall: ToolCallRef) {
    const data = this.deps.getData();
    if (!data) return;
    const matches =
      kind === "habit"
        ? resolveHabits(data, criteria)
        : kind === "recurringTask"
          ? resolveRecurringTasks(data, criteria)
          : resolveSingleTasks(data, criteria);

    if (matches.length === 0) {
      this.pushAssistantMessage("I couldn't find anything matching that to delete.", toolCall);
      return;
    }

    const ids = matches.map((match) => match.id);
    const names = matches.map((match) => match.name);

    if (kind === "singleTask" && isNameOnlyCriteria(criteria) && matches.length === 1) {
      const saved = await this.deps.persist((current) => deleteSingleTasks(current, ids));
      if (saved) this.pushAssistantMessage(`Deleted "${names[0]}".`, toolCall);
      return;
    }

    this.pendingConfirmation = { type: "delete", itemKind: kind, ids, names };
    this.pushAssistantMessage(buildDeleteConfirmationQuestion(kind, matches, data.categories, this.todayISO), toolCall);
  }

  private async resolvePendingConfirmation(confirmed: boolean, toolCall?: ToolCallRef) {
    const pending = this.pendingConfirmation;
    this.pendingConfirmation = null;
    if (!pending || !this.deps.getData()) return;

    if (pending.type === "create") {
      if (confirmed && toolCall) {
        await this.handleCreateRequest(pending.toolCall, pending.userText, { confirmedDuplicate: true, replyTo: toolCall });
      } else {
        this.pushAssistantMessage("Okay, I didn't create it.", toolCall);
      }
      return;
    }

    if (pending.type === "completeFutureTask") {
      const today = this.todayISO;
      if (!confirmed) {
        this.pushAssistantMessage(
          `Okay, I left "${pending.name}" on ${formatDate(pending.startDate, today)}.`,
          toolCall,
        );
        return;
      }
      // Moving startDate to today is the point of the question: the task's own record then
      // says it was done today, not on a day that never happened.
      const saved = await this.deps.persist((current) =>
        updateSingleTask(current, pending.taskId, { ...pending.patch, newStartDate: today }),
      );
      if (saved) this.pushAssistantMessage(`Marked "${pending.name}" done and moved it to today.`, toolCall);
      return;
    }

    if (!confirmed) {
      this.pushAssistantMessage("Okay, I won't delete that.", toolCall);
      return;
    }

    const saved = await this.deps.persist((current) =>
      pending.itemKind === "habit"
        ? deleteHabits(current, pending.ids)
        : pending.itemKind === "recurringTask"
          ? deleteRecurringTasks(current, pending.ids)
          : deleteSingleTasks(current, pending.ids),
    );
    if (saved) this.pushAssistantMessage(`Deleted ${formatQuotedList(pending.names)}.`, toolCall);
  }

  private async handleUpdateRequest(
    requestedKind: ItemKind,
    input: ItemSelector & UpdatePatch,
    toolCall: ToolCallRef,
    actionVerb: string = "Updated",
  ) {
    const data = this.deps.getData();
    if (!data) return;
    // categoryId is the §32 selector (which item), never a field to change — that's newCategoryId.
    const { name, categoryId, ...patch } = input;
    const kind = this.resolveKind(requestedKind, updateKindsFor(patch, actionVerb === "Archived"), { name, categoryId });
    const target = this.pickItem(kind, { name, categoryId }, toolCall);
    if (!target) return;
    if (!hasAnyPatchField(patch)) {
      this.pushAssistantMessage("What would you like to change about it?", toolCall);
      return;
    }

    // §29: a one-off task dated in the future can be completed early — that's honest — but
    // not silently, and the record should say when it actually happened. Habits and
    // recurring tasks have no chat path to their done/not-done toggle at all.
    if (kind === "singleTask" && patch.newDone === true && isFutureDate(target.startDate, this.todayISO)) {
      this.pendingConfirmation = {
        type: "completeFutureTask",
        taskId: target.id,
        name: target.name,
        startDate: target.startDate,
        patch,
      };
      this.pushAssistantMessage(describeFutureTaskQuestion(target.name, target.startDate, this.todayISO), toolCall);
      return;
    }

    // §31: capture before/after inside the mutator so a §21 conflict-replay
    // describes what was actually written, not a stale copy.
    let before: Habit | RecurringTask | SingleTask | undefined;
    let after: Habit | RecurringTask | SingleTask | undefined;
    const saved = await this.deps.persist((current) => {
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
      this.pushAssistantMessage(`${actionVerb} "${target.name}".`, toolCall);
    } else if (actionVerb === "Archived") {
      this.pushAssistantMessage(describeArchive(after), toolCall);
    } else {
      this.pushAssistantMessage(describeUpdate(before, after, data.categories, this.todayISO), toolCall);
    }
  }

  // §32: the model can't see the user's data, so it can guess the wrong item type (e.g.
  // updateRecurringTask for what's really a habit). If the requested type has no match,
  // use the first of `alternatives` (types that can take the same action) that does.
  // During a number-pick rerun, the picked item's own type wins.
  private resolveKind(requested: ItemKind, alternatives: ItemKind[], selector: ItemSelector): ItemKind {
    const forced = this.forcedPick;
    if (forced && (forced.kind === requested || alternatives.includes(forced.kind))) return forced.kind;
    const data = this.deps.getData();
    if (!data) return requested;
    const hasMatch = (kind: ItemKind) => selectOne(itemsOf(data, kind), selector).kind !== "none";
    if (hasMatch(requested)) return requested;
    return alternatives.find((kind) => kind !== requested && hasMatch(kind)) ?? requested;
  }

  // §32: the one place single-item chat actions (update/archive/log/checklist) resolve which
  // item the user means. Pushes the "not found" / "which one?" reply itself and returns null
  // in those cases, so callers just bail out.
  private pickItem<K extends ItemKind>(
    kind: K,
    selector: ItemSelector,
    toolCall: ToolCallRef,
    canTakeAction?: (item: ItemOfKind[K]) => boolean,
    ineligibleMessage?: (items: ItemOfKind[K][]) => string,
  ): ItemOfKind[K] | null {
    const data = this.deps.getData();
    if (!data) return null;
    const noun = ITEM_NOUNS[kind];

    const forced = this.forcedPick;
    if (forced && forced.kind === kind) {
      this.forcedPick = null;
      const item = itemsOf(data, kind).find((candidate) => candidate.id === forced.id);
      if (item && (!canTakeAction || canTakeAction(item))) return item;
      this.pushAssistantMessage(`That ${noun} doesn't seem to exist anymore.`, toolCall);
      return null;
    }

    const selection = selectOne(itemsOf(data, kind), selector, canTakeAction);
    switch (selection.kind) {
      case "one":
        return selection.item;
      case "none": {
        const category = data.categories.find((c) => c.id === selector.categoryId);
        this.pushAssistantMessage(
          `I couldn't find any ${noun} matching "${selector.name}"${category ? ` in ${category.name}` : ""}.`,
          toolCall,
        );
        return null;
      }
      case "ineligible":
        this.pushAssistantMessage(
          ineligibleMessage?.(selection.items) ?? `I couldn't find a matching ${noun} for that.`,
          toolCall,
        );
        return null;
      case "many":
        this.pendingPick = {
          kind,
          itemIds: selection.items.map((item) => item.id),
          toolCall: toolCall as DispatchableToolCall,
        };
        this.pushAssistantMessage(
          describeCandidates(noun, selector.name, selection.items, data.categories, this.todayISO),
          toolCall,
        );
        return null;
    }
  }

  // §31 + §32: creates the item and replies with what was stored — unless the name is already
  // in use, in which case nothing is created until the user confirms (resolvePendingConfirmation
  // calls back in with confirmedDuplicate, replying under the confirmation's own tool call).
  private async handleCreateRequest(
    toolCall: CreateToolCall,
    userText: string,
    options: { confirmedDuplicate?: boolean; replyTo?: ToolCallRef } = {},
  ) {
    const data = this.deps.getData();
    if (!data) return;
    const kind = CREATE_TOOL_KINDS[toolCall.name];
    const replyTo = options.replyTo ?? toolCall;
    const today = this.todayISO;

    if (!options.confirmedDuplicate) {
      const existing = findSameName<Habit | RecurringTask | SingleTask>(itemsOf(data, kind), toolCall.input.name, today);
      if (existing.length > 0) {
        this.pendingConfirmation = { type: "create", toolCall, userText };
        this.pushAssistantMessage(
          describeDuplicateQuestion(ITEM_NOUNS[kind], toolCall.input.name, existing, data.categories, today),
          toolCall,
        );
        return;
      }
    }

    // Each add* appends, so the stored item is the new array's last element.
    if (toolCall.name === "createSingleTask") {
      let created: SingleTask | undefined;
      const saved = await this.deps.persist((current) => {
        const next = addSingleTask(current, toolCall.input);
        created = next.singleTasks[next.singleTasks.length - 1];
        return next;
      });
      if (saved && created) this.pushAssistantMessage(describeCreatedSingleTask(created, toolCall.input, today), replyTo);
    } else if (toolCall.name === "createHabit") {
      let created: Habit | undefined;
      const saved = await this.deps.persist((current) => {
        const next = addHabit(current, toolCall.input);
        created = next.habits[next.habits.length - 1];
        return next;
      });
      if (saved && created) {
        this.pushAssistantMessage(describeCreatedHabit(created, toolCall.input, data.categories, userText, today), replyTo);
      }
    } else {
      let created: RecurringTask | undefined;
      const saved = await this.deps.persist((current) => {
        const next = addRecurringTask(current, toolCall.input);
        created = next.recurringTasks[next.recurringTasks.length - 1];
        return next;
      });
      if (saved && created) {
        this.pushAssistantMessage(
          describeCreatedRecurringTask(created, toolCall.input, data.categories, userText, today),
          replyTo,
        );
      }
    }
  }

  private async handleLogHabitProgress(
    input: ItemSelector & { date?: string; value?: number; delta?: number },
    toolCall: ToolCallRef,
  ) {
    // §32: only number/timer habits can take a logged value, so a same-named yes/no habit
    // never makes this ambiguous.
    const habit = this.pickItem(
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
    const today = this.todayISO;
    const dateISO = input.date ?? today;
    // §29: a day that hasn't happened yet can't have progress on it — logging one would
    // only inflate the habit's streak and completion %. Says why rather than no-opping.
    if (isFutureDate(dateISO, today)) {
      this.pushAssistantMessage(
        `I can't log progress for "${habit.name}" on ${formatDate(dateISO, today)} — that day hasn't happened yet.`,
        toolCall,
      );
      return;
    }
    // Recompute inside the mutator (not before persist()) so a delta re-derives against
    // whatever data a conflict-replay actually reloads, rather than replaying a stale
    // absolute value — see §21.
    let loggedValue = 0;
    const saved = await this.deps.persist((latest) => {
      const currentValue =
        latest.completionLog.find((entry) => entry.itemId === habit.id && entry.date === dateISO)?.value ?? 0;
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
      const dateText = dateISO === today ? "today" : `on ${formatDate(dateISO, today)}`;
      this.pushAssistantMessage(`Logged ${loggedText} for "${habit.name}" ${dateText}${goalText}.`, toolCall);
    }
  }

  // Recurring and one-off tasks share these: the model may guess the wrong task type (§32).
  private async handleAddTaskChecklistItem(
    requestedKind: "recurringTask" | "singleTask",
    input: ItemSelector & { text: string },
    toolCall: ToolCallRef,
  ) {
    const kind = this.resolveKind(requestedKind, ["recurringTask", "singleTask"], input) as "recurringTask" | "singleTask";
    const task = this.pickItem(kind, input, toolCall);
    if (!task) return;
    const saved = await this.deps.persist((current) =>
      kind === "recurringTask"
        ? addRecurringTaskChecklistItem(current, task.id, input.text)
        : addSingleTaskChecklistItem(current, task.id, input.text),
    );
    if (saved) this.pushAssistantMessage(`Added "${input.text}" to "${task.name}".`, toolCall);
  }

  private async handleCheckHabitChecklistItem(
    input: ItemSelector & { item: string; checked?: boolean; date?: string },
    toolCall: ToolCallRef,
  ) {
    const habit = this.pickItem(
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
    if (!this.checkSingleChecklistMatch(itemMatches, input.item, habit.name, toolCall)) return;
    const checked = input.checked ?? true;
    const today = this.todayISO;
    const dateISO = input.date ?? today;
    // §29: a habit's checklist state is that occurrence's completion, so the same
    // future-date rule as logHabitProgress applies.
    if (isFutureDate(dateISO, today)) {
      this.pushAssistantMessage(
        `I can't change "${habit.name}" for ${formatDate(dateISO, today)} — that day hasn't happened yet.`,
        toolCall,
      );
      return;
    }
    const saved = await this.deps.persist((current) =>
      setHabitChecklistItemChecked(current, habit.id, itemMatches[0].id, checked, dateISO),
    );
    if (saved) {
      this.pushAssistantMessage(
        `${checked ? "Checked off" : "Unchecked"} "${itemMatches[0].text}" on "${habit.name}".`,
        toolCall,
      );
    }
  }

  private async handleCheckTaskChecklistItem(
    requestedKind: "recurringTask" | "singleTask",
    input: ItemSelector & { item: string; checked?: boolean },
    toolCall: ToolCallRef,
  ) {
    const kind = this.resolveKind(requestedKind, ["recurringTask", "singleTask"], input) as "recurringTask" | "singleTask";
    const task = this.pickItem(kind, input, toolCall);
    if (!task) return;
    const itemMatches = resolveChecklistItemMatches(task.checklist, input.item);
    if (!this.checkSingleChecklistMatch(itemMatches, input.item, task.name, toolCall)) return;
    const checked = input.checked ?? true;
    const saved = await this.deps.persist((current) =>
      kind === "recurringTask"
        ? setRecurringTaskChecklistItemChecked(current, task.id, itemMatches[0].id, checked)
        : setSingleTaskChecklistItemChecked(current, task.id, itemMatches[0].id, checked),
    );
    if (saved) {
      this.pushAssistantMessage(
        `${checked ? "Checked off" : "Unchecked"} "${itemMatches[0].text}" on "${task.name}".`,
        toolCall,
      );
    }
  }

  /** Replies and returns false unless exactly one checklist item matched. */
  private checkSingleChecklistMatch(
    itemMatches: ChecklistItem[],
    fragment: string,
    ownerName: string,
    toolCall: ToolCallRef,
  ): boolean {
    if (itemMatches.length === 0) {
      this.pushAssistantMessage(`I couldn't find a checklist item matching "${fragment}" on "${ownerName}".`, toolCall);
      return false;
    }
    if (itemMatches.length > 1) {
      this.pushAssistantMessage(
        `I found more than one checklist item matching "${fragment}" on "${ownerName}": ${formatQuotedList(itemMatches.map((item) => item.text))}. Which one did you mean?`,
        toolCall,
      );
      return false;
    }
    return true;
  }
}
