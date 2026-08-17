// Pure functions over AppData. Kept as plain reducers (not a class or a
// state-management library) — the app is small enough that App.tsx owning
// the state and calling these directly is simpler than adding a dependency.
import type { AppData, SingleTask } from "../types/models";

export interface CreateSingleTaskInput {
  name: string;
  description?: string;
  categoryId?: string;
  priority?: number;
}

export function addSingleTask(data: AppData, input: CreateSingleTaskInput): AppData {
  const task: SingleTask = {
    kind: "singleTask",
    id: crypto.randomUUID(),
    name: input.name,
    description: input.description,
    categoryId: input.categoryId,
    priority: input.priority ?? 0,
    startDate: new Date().toISOString().slice(0, 10),
    done: false,
  };
  return { ...data, singleTasks: [...data.singleTasks, task] };
}

export function toggleSingleTaskDone(data: AppData, taskId: string): AppData {
  return {
    ...data,
    singleTasks: data.singleTasks.map((task) =>
      task.id === taskId ? { ...task, done: !task.done } : task,
    ),
  };
}
