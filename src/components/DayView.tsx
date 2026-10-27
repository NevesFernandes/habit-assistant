import type { Category, ChecklistItem, CompletionLogEntry, DayNote, Habit, RecurringTask, SingleTask } from "../types/models";
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, ListChecks, MoreVertical } from "lucide-react";
import { completionsInPeriod, getHabitsForDate, getRecurringTasksForDate, isFutureDate } from "../lib/recurrence";
import { isSingleTaskActiveOn } from "../lib/dataStore";
import { checklistItemsForEntry, checklistProgress, isHabitEntryComplete } from "../lib/habitStats";
import { useWeekStart } from "../lib/weekStartContext";
import { recurringTaskChecklistOn } from "../lib/recurringChecklist";
import CategoryIcon from "./CategoryIcon";
import DayPartPicker, { ImportantMark, type PlacementPatch } from "./DayPartPicker";
import { groupByDayPart, isImportant, type DayPartGroup } from "../lib/dayParts";
import Checklist from "./Checklist";
import { CompletionControl, YesNoCheckbox } from "./CompletionControl";
import { formatDurationMinutes } from "../lib/duration";
import { noteOn } from "../lib/dayNotes";

type DayItem =
  | { kind: "habit"; item: Habit }
  | { kind: "singleTask"; item: SingleTask }
  | { kind: "recurringTask"; item: RecurringTask };

interface DayViewProps {
  selectedDate: string;
  todayISO: string;
  habits: Habit[];
  singleTasks: SingleTask[];
  recurringTasks: RecurringTask[];
  completionLog: CompletionLogEntry[];
  /** §67: each item's note for the selected day shows under it. */
  notes?: DayNote[];
  categories: Category[];
  onToggleHabit: (habitId: string) => void;
  onToggleTask: (taskId: string) => void;
  onToggleRecurringTask: (taskId: string) => void;
  onToggleHabitChecklistItem: (habitId: string, itemId: string) => void;
  /** §29: completing a future-dated one-off task, which also moves it to today. */
  onCompleteFutureTask: (taskId: string) => void;
  /** §39: a task's attached checklist, editable from any day — it isn't completion status. */
  onToggleTaskChecklistItem: (taskId: string, itemId: string) => void;
  onAddTaskChecklistItem: (taskId: string, text: string) => void;
  onRemoveTaskChecklistItem: (taskId: string, itemId: string) => void;
  onToggleRecurringTaskChecklistItem: (taskId: string, itemId: string) => void;
  onAddRecurringTaskChecklistItem: (taskId: string, text: string) => void;
  onRemoveRecurringTaskChecklistItem: (taskId: string, itemId: string) => void;
  /** §54: moves an item to another part of the day, or flags it, without leaving the day. */
  onPlaceItem: (kind: DayItem["kind"], id: string, patch: PlacementPatch) => void;
}

function getItemsForDate(
  habits: Habit[],
  singleTasks: SingleTask[],
  recurringTasks: RecurringTask[],
  dateISO: string,
): DayItem[] {
  const habitItems: DayItem[] = getHabitsForDate(habits, dateISO).map((item) => ({ kind: "habit", item }));
  const taskItems: DayItem[] = singleTasks
    .filter((task) => isSingleTaskActiveOn(task, dateISO))
    .map((item) => ({ kind: "singleTask", item }));
  const recurringTaskItems: DayItem[] = getRecurringTasksForDate(recurringTasks, dateISO).map((item) => ({
    kind: "recurringTask",
    item,
  }));
  return [...habitItems, ...taskItems, ...recurringTaskItems];
}

// §54: the day's items under a heading per part of the day, in day order.
function getGroupsForDate(...args: Parameters<typeof getItemsForDate>): DayPartGroup<DayItem>[] {
  return groupByDayPart(getItemsForDate(...args), (entry) => entry.item);
}

export default function DayView({
  selectedDate,
  todayISO,
  habits,
  singleTasks,
  recurringTasks,
  completionLog,
  notes,
  categories,
  onToggleHabit,
  onToggleTask,
  onToggleRecurringTask,
  onToggleHabitChecklistItem,
  onCompleteFutureTask,
  onToggleTaskChecklistItem,
  onAddTaskChecklistItem,
  onRemoveTaskChecklistItem,
  onToggleRecurringTaskChecklistItem,
  onAddRecurringTaskChecklistItem,
  onRemoveRecurringTaskChecklistItem,
  onPlaceItem,
}: DayViewProps) {
  const groups = getGroupsForDate(habits, singleTasks, recurringTasks, selectedDate);
  // §29: a day that hasn't happened yet is read-only for completion. One-off tasks are the
  // exception — they can be done early, after confirming the move to today.
  const isFuture = isFutureDate(selectedDate, todayISO);
  const [confirmingTaskId, setConfirmingTaskId] = useState<string | null>(null);
  // §54: the one row whose part-of-day buttons are open. A wrongly assumed part is fixed
  // here, in two taps, instead of through the item's own page or a chat message.
  const [placingId, setPlacingId] = useState<string | null>(null);
  const placeControl = (entry: DayItem) => (
    <button
      onClick={() => setPlacingId((open) => (open === entry.item.id ? null : entry.item.id))}
      aria-label={`Change part of day for ${entry.item.name}`}
      aria-expanded={placingId === entry.item.id}
      title="Part of day"
      className={`shrink-0 rounded-md p-1 hover:bg-slate-700 hover:text-slate-200 ${
        placingId === entry.item.id ? "bg-slate-700 text-slate-200" : "text-slate-500"
      }`}
    >
      <MoreVertical className="h-4 w-4" aria-hidden />
    </button>
  );
  const placePanel = (entry: DayItem) =>
    placingId === entry.item.id ? (
      <div className="w-full border-t border-slate-700 pt-2 text-sm">
        <div className="text-xs text-slate-500">Part of day</div>
        <DayPartPicker
          item={entry.item}
          onChange={(patch) => {
            onPlaceItem(entry.kind, entry.item.id, patch);
            // The item moves to another heading, so the buttons close; a star toggle stays put.
            if (patch.newDayPart) setPlacingId(null);
          }}
        />
      </div>
    ) : null;

  if (groups.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        Nothing for this date — ask the assistant to add a habit or task.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {isFuture && (
        <p className="text-xs text-amber-300/80">
          This day hasn't happened yet — you can plan here, but completion can only be ticked on the day itself.
        </p>
      )}
      {groups.map((group) => (
      <section key={group.part ?? "unplaced"} className="flex flex-col gap-2">
      <h3 className="pt-1 text-xs font-medium uppercase tracking-wide text-slate-400">{group.label}</h3>
      <ul className="flex flex-col gap-2">
      {group.items.map((entry) => {
        if (entry.kind === "habit") {
          return (
            <HabitRow
              key={entry.item.id}
              note={noteOn({ notes }, entry.item.id, selectedDate)}
              placeControl={placeControl(entry)}
              placePanel={placePanel(entry)}
              habit={entry.item}
              selectedDate={selectedDate}
              completionLog={completionLog}
              categories={categories}
              readOnly={isFuture}
              onToggle={onToggleHabit}
              onToggleChecklistItem={onToggleHabitChecklistItem}
            />
          );
        }
        if (entry.kind === "recurringTask") {
          return (
            <RecurringTaskRow
              key={entry.item.id}
              note={noteOn({ notes }, entry.item.id, selectedDate)}
              placeControl={placeControl(entry)}
              placePanel={placePanel(entry)}
              task={entry.item}
              selectedDate={selectedDate}
              completionLog={completionLog}
              categories={categories}
              readOnly={isFuture}
              onToggle={onToggleRecurringTask}
              onToggleChecklistItem={onToggleRecurringTaskChecklistItem}
              onAddChecklistItem={onAddRecurringTaskChecklistItem}
              onRemoveChecklistItem={onRemoveRecurringTaskChecklistItem}
            />
          );
        }
        return (
          <TaskRow
            key={entry.item.id}
            note={noteOn({ notes }, entry.item.id, selectedDate)}
            placeControl={placeControl(entry)}
            placePanel={placePanel(entry)}
            task={entry.item}
            categories={categories}
            isFuture={isFuture}
            confirming={confirmingTaskId === entry.item.id}
            onToggle={onToggleTask}
            onToggleChecklistItem={onToggleTaskChecklistItem}
            onAddChecklistItem={onAddTaskChecklistItem}
            onRemoveChecklistItem={onRemoveTaskChecklistItem}
            onAskConfirm={() => setConfirmingTaskId(entry.item.id)}
            onCancelConfirm={() => setConfirmingTaskId(null)}
            onConfirm={() => {
              setConfirmingTaskId(null);
              onCompleteFutureTask(entry.item.id);
            }}
          />
        );
      })}
      </ul>
      </section>
      ))}
    </div>
  );
}

const FUTURE_TITLE = "This day hasn't happened yet";

/** §67: the day's note. inline-block keeps a done row's strike-through off it. */
function NoteLine({ note }: { note?: string }) {
  if (!note) return null;
  return <div className="inline-block text-xs italic text-sky-300">“{note}”</div>;
}

function HabitRow({
  habit,
  note,
  placeControl,
  placePanel,
  selectedDate,
  completionLog,
  categories,
  readOnly,
  onToggle,
  onToggleChecklistItem,
}: {
  habit: Habit;
  note?: string;
  placeControl: ReactNode;
  placePanel: ReactNode;
  selectedDate: string;
  completionLog: CompletionLogEntry[];
  categories: Category[];
  readOnly: boolean;
  onToggle: (habitId: string) => void;
  onToggleChecklistItem: (habitId: string, itemId: string) => void;
}) {
  const weekStartsOn = useWeekStart();
  const category = categories.find((c) => c.id === habit.categoryId);
  const entry = completionLog.find((e) => e.itemId === habit.id && e.date === selectedDate);
  const isDone = isHabitEntryComplete(habit, entry);
  const checklistItems = habit.completionType === "checklist" ? checklistItemsForEntry(habit, entry, selectedDate) : [];
  const progress = habit.completionType === "checklist" ? checklistProgress(habit, entry, selectedDate) : null;
  return (
    <li
      className={`flex gap-3 rounded-md bg-slate-800 px-3 py-2 ${
        habit.completionType === "checklist" || placePanel ? "flex-col" : "items-center"
      }`}
    >
      <div className="flex w-full items-center gap-3">
        <CategoryIcon name={category?.icon} className="h-4 w-4 shrink-0" />
        <div className={`flex-1 ${isDone ? "text-slate-500 line-through" : ""}`}>
          <div>
            {habit.name}
            {isImportant(habit) && <ImportantMark />}
          </div>
          {habit.description && <div className="text-xs text-slate-500">{habit.description}</div>}
          <NoteLine note={note} />
          {habit.recurrence.type === "timesPerPeriod" && (
            <div className="text-xs text-violet-300">
              {completionsInPeriod(completionLog, habit.id, selectedDate, habit.recurrence.period, weekStartsOn)}/
              {habit.recurrence.count} this {habit.recurrence.period}
            </div>
          )}
        </div>
        {habit.completionType === "yesno" ? (
          <YesNoCheckbox
            checked={isDone}
            onChange={() => onToggle(habit.id)}
            disabled={readOnly}
            title={readOnly ? FUTURE_TITLE : undefined}
          />
        ) : habit.completionType === "value" || habit.completionType === "timer" ? (
          <CompletionControl>
            <span className="rounded-md bg-slate-700 px-2 py-1 text-xs text-slate-300">
              {habit.completionType === "timer" ? (
                <>
                  {entry?.value !== undefined ? formatDurationMinutes(entry.value) : "—"}
                  {habit.target !== undefined ? ` / ${formatDurationMinutes(habit.target)}` : ""}
                </>
              ) : (
                <>
                  {entry?.value ?? "—"}
                  {habit.target !== undefined ? ` / ${habit.target}` : ""}
                  {habit.unit ? ` ${habit.unit}` : ""}
                </>
              )}
            </span>
          </CompletionControl>
        ) : progress ? (
          <CompletionControl>
            <span className="rounded-md bg-slate-700 px-2 py-1 text-xs text-slate-300">
              {progress.checked}/{progress.total}
            </span>
          </CompletionControl>
        ) : null}
        {placeControl}
      </div>
      {placePanel}
      {habit.completionType === "checklist" && (
        <Checklist
          items={checklistItems}
          onToggle={(itemId) => onToggleChecklistItem(habit.id, itemId)}
          disabled={readOnly}
          title={readOnly ? FUTURE_TITLE : undefined}
        />
      )}
    </li>
  );
}

function RecurringTaskRow({
  task,
  note,
  placeControl,
  placePanel,
  selectedDate,
  completionLog,
  categories,
  readOnly,
  onToggle,
  onToggleChecklistItem,
  onAddChecklistItem,
  onRemoveChecklistItem,
}: {
  task: RecurringTask;
  note?: string;
  placeControl: ReactNode;
  placePanel: ReactNode;
  selectedDate: string;
  completionLog: CompletionLogEntry[];
  categories: Category[];
  readOnly: boolean;
  onToggle: (taskId: string) => void;
  onToggleChecklistItem: (taskId: string, itemId: string) => void;
  onAddChecklistItem: (taskId: string, text: string) => void;
  onRemoveChecklistItem: (taskId: string, itemId: string) => void;
}) {
  const weekStartsOn = useWeekStart();
  const category = categories.find((c) => c.id === task.categoryId);
  const isDone = completionLog.some((entry) => entry.itemId === task.id && entry.date === selectedDate);
  // §42: this occurrence's list, not the stored items (see recurringChecklist.ts).
  const items = recurringTaskChecklistOn(task, selectedDate);
  const checklist = useTaskChecklist(items, selectedDate, isDone, !readOnly);
  return (
    <li className="flex flex-col gap-2 rounded-md bg-slate-800 px-3 py-2">
      <div className="flex w-full items-center gap-3">
        <CategoryIcon name={category?.icon} className="h-4 w-4 shrink-0" />
        <div
          className={`flex-1 ${isDone ? "text-slate-500 line-through" : ""} ${items ? "cursor-pointer" : ""}`}
          onClick={checklist.toggleExpanded}
        >
          <div>
            {task.name}
            {isImportant(task) && <ImportantMark />}
          </div>
          {task.description && <div className="text-xs text-slate-500">{task.description}</div>}
          <NoteLine note={note} />
          {task.recurrence.type === "timesPerPeriod" && (
            <div className="text-xs text-violet-300">
              {completionsInPeriod(completionLog, task.id, selectedDate, task.recurrence.period, weekStartsOn)}/
              {task.recurrence.count} this {task.recurrence.period}
            </div>
          )}
        </div>
        {items && <ChecklistBadge items={items} expanded={checklist.expanded} onClick={checklist.toggleExpanded} />}
        <YesNoCheckbox
          checked={isDone}
          onChange={() => onToggle(task.id)}
          disabled={readOnly}
          title={readOnly ? FUTURE_TITLE : undefined}
        />
        {placeControl}
      </div>
      {placePanel}
      {items && checklist.expanded && (
        <TaskChecklistPanel
          items={items}
          showDonePrompt={checklist.showDonePrompt}
          onToggleItem={(itemId) => checklist.onToggleItem(itemId, () => onToggleChecklistItem(task.id, itemId))}
          onAddItem={(text) => onAddChecklistItem(task.id, text)}
          onRemoveItem={(itemId) => onRemoveChecklistItem(task.id, itemId)}
          onMarkDone={() => {
            checklist.dismissDonePrompt();
            onToggle(task.id);
          }}
          onDismissDonePrompt={checklist.dismissDonePrompt}
        />
      )}
    </li>
  );
}

// §29: a one-off task can honestly be done early, so instead of blocking the tick on a
// future day it asks — and says that yes moves the task to today, which is also why it
// then disappears from the day being viewed.
function TaskRow({
  task,
  note,
  placeControl,
  placePanel,
  categories,
  isFuture,
  confirming,
  onToggle,
  onToggleChecklistItem,
  onAddChecklistItem,
  onRemoveChecklistItem,
  onAskConfirm,
  onCancelConfirm,
  onConfirm,
}: {
  task: SingleTask;
  note?: string;
  placeControl: ReactNode;
  placePanel: ReactNode;
  categories: Category[];
  isFuture: boolean;
  confirming: boolean;
  onToggle: (taskId: string) => void;
  onToggleChecklistItem: (taskId: string, itemId: string) => void;
  onAddChecklistItem: (taskId: string, text: string) => void;
  onRemoveChecklistItem: (taskId: string, itemId: string) => void;
  onAskConfirm: () => void;
  onCancelConfirm: () => void;
  onConfirm: () => void;
}) {
  const category = categories.find((c) => c.id === task.categoryId);
  const askFirst = isFuture && !task.done;
  const checklist = useTaskChecklist(task.checklist, task.startDate, task.done, !isFuture);
  return (
    <li className="flex flex-col gap-2 rounded-md bg-slate-800 px-3 py-2">
      <div className="flex w-full items-center gap-3">
        <CategoryIcon name={category?.icon} className="h-4 w-4 shrink-0" />
        <div
          className={`flex-1 ${task.done ? "text-slate-500 line-through" : ""} ${task.checklist ? "cursor-pointer" : ""}`}
          onClick={checklist.toggleExpanded}
        >
          <div>
            {task.name}
            {isImportant(task) && <ImportantMark />}
          </div>
          {task.description && <div className="text-xs text-slate-500">{task.description}</div>}
          <NoteLine note={note} />
        </div>
        {task.checklist && (
          <ChecklistBadge items={task.checklist} expanded={checklist.expanded} onClick={checklist.toggleExpanded} />
        )}
        <YesNoCheckbox
          checked={task.done}
          onChange={() => (askFirst ? onAskConfirm() : onToggle(task.id))}
        />
        {placeControl}
      </div>
      {placePanel}
      {task.checklist && checklist.expanded && (
        <TaskChecklistPanel
          items={task.checklist}
          showDonePrompt={checklist.showDonePrompt}
          onToggleItem={(itemId) => checklist.onToggleItem(itemId, () => onToggleChecklistItem(task.id, itemId))}
          onAddItem={(text) => onAddChecklistItem(task.id, text)}
          onRemoveItem={(itemId) => onRemoveChecklistItem(task.id, itemId)}
          onMarkDone={() => {
            checklist.dismissDonePrompt();
            onToggle(task.id);
          }}
          onDismissDonePrompt={checklist.dismissDonePrompt}
        />
      )}
      {confirming && (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-700 pt-2 text-xs text-slate-300">
          <span>This task is in the future. Mark it complete and move it to today?</span>
          <button
            onClick={onConfirm}
            className="rounded-md bg-violet-500 px-2 py-1 text-white hover:bg-violet-400"
          >
            Yes
          </button>
          <button onClick={onCancelConfirm} className="rounded-md bg-slate-700 px-2 py-1 hover:bg-slate-600">
            No
          </button>
        </div>
      )}
    </li>
  );
}

// §39: a task's attached checklist in the day view — closed by default behind a progress
// badge. Ticking the last open item offers (never forces) marking the task itself done;
// the offer only appears when the task can be completed from this day (not a future one).
function useTaskChecklist(
  items: ChecklistItem[] | undefined,
  selectedDate: string,
  isDone: boolean,
  canOfferDone: boolean,
) {
  const [expanded, setExpanded] = useState(false);
  // The day the offer was made for: the same row is reused when a recurring task also
  // shows on the next day viewed, and the offer mustn't follow it there.
  const [donePromptDate, setDonePromptDate] = useState<string | null>(null);
  const allChecked = !!items && items.length > 0 && items.every((item) => item.checked);
  return {
    expanded,
    toggleExpanded: () => {
      if (items) setExpanded((open) => !open);
    },
    // Derived, so unticking an item, adding one, or completing the task hides it again.
    showDonePrompt: donePromptDate === selectedDate && allChecked && !isDone && canOfferDone,
    dismissDonePrompt: () => setDonePromptDate(null),
    onToggleItem: (itemId: string, toggle: () => void) => {
      const target = items?.find((item) => item.id === itemId);
      const ticksLastOpenItem =
        !!target && !target.checked && items!.every((item) => item.checked || item.id === itemId);
      toggle();
      setDonePromptDate(ticksLastOpenItem ? selectedDate : null);
    },
  };
}

function ChecklistBadge({ items, expanded, onClick }: { items: ChecklistItem[]; expanded: boolean; onClick: () => void }) {
  const checked = items.filter((item) => item.checked).length;
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <button
      onClick={onClick}
      aria-expanded={expanded}
      aria-label={`Checklist, ${checked} of ${items.length} checked`}
      className="flex shrink-0 items-center gap-1 rounded-md bg-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-600"
    >
      <ListChecks className="h-3.5 w-3.5" aria-hidden />
      {checked}/{items.length}
      <Chevron className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}

function TaskChecklistPanel({
  items,
  showDonePrompt,
  onToggleItem,
  onAddItem,
  onRemoveItem,
  onMarkDone,
  onDismissDonePrompt,
}: {
  items: ChecklistItem[];
  showDonePrompt: boolean;
  onToggleItem: (itemId: string) => void;
  onAddItem: (text: string) => void;
  onRemoveItem: (itemId: string) => void;
  onMarkDone: () => void;
  onDismissDonePrompt: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-slate-700 pt-2 pl-7 text-sm">
      <Checklist items={items} onToggle={onToggleItem} onAdd={onAddItem} onRemove={onRemoveItem} />
      {showDonePrompt && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
          <span>All items checked. Mark the task done?</span>
          <button onClick={onMarkDone} className="rounded-md bg-violet-500 px-2 py-1 text-white hover:bg-violet-400">
            Yes
          </button>
          <button onClick={onDismissDonePrompt} className="rounded-md bg-slate-700 px-2 py-1 hover:bg-slate-600">
            No
          </button>
        </div>
      )}
    </div>
  );
}
