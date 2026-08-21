import { useState } from "react";
import type { Category, CompletionLogEntry, Habit, RecurringTask, SingleTask } from "../types/models";
import type { CreateCategoryInput, UpdateCategoryPatch } from "../lib/dataStore";
import { aggregateCategoryStats } from "../lib/habitStats";
import { todayISO } from "../lib/recurrence";
import CategoryIcon from "./CategoryIcon";
import IconPicker from "./IconPicker";
import { DEFAULT_ICON_NAME } from "../lib/icons";

interface CategoriesViewProps {
  categories: Category[];
  habits: Habit[];
  recurringTasks: RecurringTask[];
  singleTasks: SingleTask[];
  completionLog: CompletionLogEntry[];
  onAdd: (input: CreateCategoryInput) => void;
  onUpdate: (id: string, patch: UpdateCategoryPatch) => void;
  onDelete: (id: string) => boolean;
}

export default function CategoriesView({
  categories,
  habits,
  completionLog,
  onAdd,
  onUpdate,
  onDelete,
}: CategoriesViewProps) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftIcon, setDraftIcon] = useState(DEFAULT_ICON_NAME);
  const [blockedDeleteId, setBlockedDeleteId] = useState<string | null>(null);
  const [viewingStatsForId, setViewingStatsForId] = useState<string | null>(null);

  function startAdding() {
    setEditingId(null);
    setDraftName("");
    setDraftIcon(DEFAULT_ICON_NAME);
    setBlockedDeleteId(null);
    setAdding(true);
  }

  function startEditing(category: Category) {
    setAdding(false);
    setDraftName(category.name);
    setDraftIcon(category.icon);
    setBlockedDeleteId(null);
    setEditingId(category.id);
  }

  function cancelForm() {
    setAdding(false);
    setEditingId(null);
  }

  function handleCreate() {
    if (!draftName.trim()) return;
    onAdd({ name: draftName.trim(), icon: draftIcon });
    setAdding(false);
  }

  function handleSave(id: string) {
    if (!draftName.trim()) return;
    onUpdate(id, { newName: draftName.trim(), newIcon: draftIcon });
    setEditingId(null);
  }

  function handleDelete(id: string) {
    setBlockedDeleteId(null);
    const deleted = onDelete(id);
    if (!deleted) setBlockedDeleteId(id);
  }

  const viewingStatsFor = viewingStatsForId ? categories.find((c) => c.id === viewingStatsForId) : undefined;
  if (viewingStatsFor) {
    return (
      <CategoryStatsView
        category={viewingStatsFor}
        habits={habits.filter((h) => h.categoryId === viewingStatsFor.id)}
        completionLog={completionLog}
        onBack={() => setViewingStatsForId(null)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {categories.length === 0 ? (
        <p className="text-sm text-slate-500">No categories yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {categories.map((category) => (
            <li key={category.id} className="rounded-md bg-slate-800 px-3 py-2">
              {editingId === category.id ? (
                <CategoryForm
                  name={draftName}
                  icon={draftIcon}
                  onNameChange={setDraftName}
                  onIconChange={setDraftIcon}
                  onSubmit={() => handleSave(category.id)}
                  onCancel={cancelForm}
                  submitLabel="Save"
                />
              ) : (
                <div className="flex items-center gap-3">
                  <CategoryIcon name={category.icon} className="h-4 w-4 shrink-0" />
                  <div className="flex-1">{category.name}</div>
                  <button
                    onClick={() => setViewingStatsForId(category.id)}
                    className="rounded-md bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600"
                  >
                    Stats
                  </button>
                  <button
                    onClick={() => startEditing(category)}
                    className="rounded-md bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(category.id)}
                    className="rounded-md bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600"
                  >
                    Delete
                  </button>
                </div>
              )}
              {blockedDeleteId === category.id && (
                <p className="mt-2 text-xs text-red-400">
                  Can't delete — still used by a habit or task.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="rounded-md bg-slate-800 px-3 py-2">
          <CategoryForm
            name={draftName}
            icon={draftIcon}
            onNameChange={setDraftName}
            onIconChange={setDraftIcon}
            onSubmit={handleCreate}
            onCancel={cancelForm}
            submitLabel="Create"
          />
        </div>
      ) : (
        <button
          onClick={startAdding}
          className="self-start rounded-md bg-violet-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-400"
        >
          + Add category
        </button>
      )}
    </div>
  );
}

function CategoryStatsView({
  category,
  habits,
  completionLog,
  onBack,
}: {
  category: Category;
  habits: Habit[];
  completionLog: CompletionLogEntry[];
  onBack: () => void;
}) {
  const stats = aggregateCategoryStats(habits, completionLog, todayISO());

  return (
    <div className="flex flex-col gap-3">
      <button
        onClick={onBack}
        className="self-start rounded-md bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600"
      >
        ← Back to categories
      </button>

      <div className="flex flex-col gap-2 rounded-md bg-slate-800 px-4 py-3">
        <div className="flex items-center gap-2 text-lg font-medium">
          <CategoryIcon name={category.icon} className="h-5 w-5 shrink-0" />
          {category.name}
        </div>

        {habits.length === 0 ? (
          <p className="text-sm text-slate-500">No habits in this category yet.</p>
        ) : (
          <>
            <div>
              <div className="text-xs text-slate-500">Completion rate</div>
              <div>{stats.completionPercentage}%</div>
            </div>

            <div>
              <div className="text-xs text-slate-500">Completions</div>
              <div className="flex gap-4">
                <StatTile value={stats.completionsThisWeek} label="This week" />
                <StatTile value={stats.completionsThisMonth} label="This month" />
                <StatTile value={stats.completionsThisYear} label="This year" />
                <StatTile value={stats.completionsAllTime} label="All-time" />
              </div>
            </div>

            <div>
              <div className="text-xs text-slate-500">Habits in this category</div>
              <ul className="list-disc pl-5">
                {habits.map((habit) => (
                  <li key={habit.id}>{habit.name}</li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatTile({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="text-base font-medium">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

function CategoryForm({
  name,
  icon,
  onNameChange,
  onIconChange,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  name: string;
  icon: string;
  onNameChange: (value: string) => void;
  onIconChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel: string;
}) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <label className="block text-slate-300">Name</label>
      <input
        value={name}
        onChange={(event) => onNameChange(event.target.value)}
        className="w-full rounded-md bg-slate-900 px-2 py-1.5"
      />
      <label className="block text-slate-300">Icon</label>
      <IconPicker value={icon} onChange={onIconChange} />
      <div className="flex gap-2">
        <button
          onClick={onSubmit}
          disabled={!name.trim()}
          className="rounded-md bg-violet-500 px-3 py-1.5 font-medium text-white hover:bg-violet-400 disabled:opacity-50"
        >
          {submitLabel}
        </button>
        <button onClick={onCancel} className="rounded-md bg-slate-700 px-3 py-1.5 hover:bg-slate-600">
          Cancel
        </button>
      </div>
    </div>
  );
}
