import { useState, type ReactNode } from "react";
import type { Category, SingleTask } from "../types/models";
import CategoryIcon from "./CategoryIcon";
import Checklist from "./Checklist";

interface SingleTasksViewProps {
  singleTasks: SingleTask[];
  categories: Category[];
  onToggleChecklistItem: (taskId: string, itemId: string) => void;
  onAddChecklistItem: (taskId: string, text: string) => void;
}

export default function SingleTasksView({
  singleTasks,
  categories,
  onToggleChecklistItem,
  onAddChecklistItem,
}: SingleTasksViewProps) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const selectedTask = selectedTaskId ? singleTasks.find((task) => task.id === selectedTaskId) : undefined;

  if (selectedTask) {
    return (
      <SingleTaskDetail
        task={selectedTask}
        categories={categories}
        onToggleChecklistItem={onToggleChecklistItem}
        onAddChecklistItem={onAddChecklistItem}
        onBack={() => setSelectedTaskId(null)}
      />
    );
  }

  const sortedTasks = singleTasks
    .slice()
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));

  if (sortedTasks.length === 0) {
    return <p className="text-sm text-slate-500">No tasks yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {sortedTasks.map((task) => {
        const category = categories.find((c) => c.id === task.categoryId);
        return (
          <li key={task.id}>
            <button
              onClick={() => setSelectedTaskId(task.id)}
              className="flex w-full items-center gap-3 rounded-md bg-slate-800 px-3 py-2 text-left hover:bg-slate-700"
            >
              <CategoryIcon name={category?.icon} className="h-4 w-4 shrink-0" />
              <div className="flex-1">
                <div>
                  <span className={task.done ? "text-slate-500 line-through" : ""}>{task.name}</span>
                  {task.done && <span className="ml-2 text-xs text-emerald-400">Done</span>}
                </div>
                {task.description && (
                  <div className={`text-xs ${task.done ? "text-slate-500 line-through" : "text-slate-500"}`}>
                    {task.description}
                  </div>
                )}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function SingleTaskDetail({
  task,
  categories,
  onToggleChecklistItem,
  onAddChecklistItem,
  onBack,
}: {
  task: SingleTask;
  categories: Category[];
  onToggleChecklistItem: (taskId: string, itemId: string) => void;
  onAddChecklistItem: (taskId: string, text: string) => void;
  onBack: () => void;
}) {
  const category = categories.find((c) => c.id === task.categoryId);

  return (
    <div className="flex flex-col gap-3">
      <button
        onClick={onBack}
        className="self-start rounded-md bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600"
      >
        ← Back to tasks
      </button>

      <div className="flex flex-col gap-2 rounded-md bg-slate-800 px-4 py-3">
        <div className="flex items-center gap-2 text-lg font-medium">
          <CategoryIcon name={category?.icon} className="h-5 w-5 shrink-0" />
          {task.name}
        </div>

        {task.description && (
          <DetailRow label="Description">
            <span>{task.description}</span>
          </DetailRow>
        )}

        <DetailRow label="Category">
          <span>{category?.name ?? "None"}</span>
        </DetailRow>

        <DetailRow label="Priority">
          <span>{task.priority}</span>
        </DetailRow>

        <DetailRow label="Start date">
          <span>{task.startDate}</span>
        </DetailRow>

        {task.persistency && task.originalStartDate && task.originalStartDate !== task.startDate && (
          <DetailRow label="Originally due">
            <span>{task.originalStartDate}</span>
          </DetailRow>
        )}

        {task.endDate && (
          <DetailRow label="End date">
            <span>{task.endDate}</span>
          </DetailRow>
        )}

        <DetailRow label="Status">
          <span>{task.done ? "Done" : "Not done"}</span>
        </DetailRow>

        <DetailRow label="Persistency">
          <span>{task.persistency ? "Carries forward until done" : "One-time only"}</span>
        </DetailRow>

        <DetailRow label="Checklist items">
          <Checklist
            items={task.checklist ?? []}
            onToggle={(itemId) => onToggleChecklistItem(task.id, itemId)}
            onAdd={(text) => onAddChecklistItem(task.id, text)}
          />
        </DetailRow>
      </div>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div>{children}</div>
    </div>
  );
}
