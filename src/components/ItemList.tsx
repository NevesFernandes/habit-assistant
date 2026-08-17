import type { SingleTask } from "../types/models";

interface ItemListProps {
  tasks: SingleTask[];
  onToggle: (taskId: string) => void;
}

export default function ItemList({ tasks, onToggle }: ItemListProps) {
  if (tasks.length === 0) {
    return <p className="text-sm text-slate-500">No tasks yet — ask the assistant to add one.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {tasks
        .slice()
        .sort((a, b) => b.priority - a.priority)
        .map((task) => (
          <li key={task.id} className="flex items-center gap-3 rounded-md bg-slate-800 px-3 py-2">
            <input
              type="checkbox"
              checked={task.done}
              onChange={() => onToggle(task.id)}
              className="h-4 w-4"
            />
            <div className={task.done ? "text-slate-500 line-through" : ""}>
              <div>{task.name}</div>
              {task.description && (
                <div className="text-xs text-slate-500">{task.description}</div>
              )}
            </div>
          </li>
        ))}
    </ul>
  );
}
