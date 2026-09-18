// §32 in Roadmap.md: one shared way to pick the single item a chat request
// refers to (update/archive/log/checklist), instead of each App.tsx handler
// doing its own name-fragment match. Deliberately separate from dataStore.ts's
// resolveX (DeleteCriteria), which intentionally matches *many* items for
// bulk delete. Type-only imports, so it's runnable under node for tests.
import type { BaseItem, Habit, RecurringTask, SingleTask } from "../types/models.ts";

export interface ItemSelector {
  name: string;
  // Only used to pick between same-named items the app already listed —
  // never a new value (see the tool descriptions in handleAgentRequest.ts).
  categoryId?: string;
}

export type Selection<T> =
  | { kind: "none" }
  // Name matched, but nothing that can take this action — lets the caller
  // explain why (e.g. "isn't tracked with a number") instead of "not found".
  | { kind: "ineligible"; items: T[] }
  | { kind: "one"; item: T }
  | { kind: "many"; items: T[] };

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

export function selectOne<T extends BaseItem>(
  items: T[],
  selector: ItemSelector,
  canTakeAction: (item: T) => boolean = () => true,
): Selection<T> {
  const needle = normalize(selector.name);
  if (!needle) return { kind: "none" };

  let candidates = items.filter((item) => normalize(item.name).includes(needle));
  if (selector.categoryId) {
    candidates = candidates.filter((item) => item.categoryId === selector.categoryId);
  }
  if (candidates.length === 0) return { kind: "none" };

  const eligible = candidates.filter(canTakeAction);
  if (eligible.length === 0) return { kind: "ineligible", items: candidates };

  const exact = eligible.filter((item) => normalize(item.name) === needle);
  const narrowed = exact.length > 0 ? exact : eligible;
  return narrowed.length === 1 ? { kind: "one", item: narrowed[0] } : { kind: "many", items: narrowed };
}

type AnyItem = Habit | RecurringTask | SingleTask;

/** Still-live items with exactly this name — archived habits/recurring tasks and finished one-off tasks don't count. */
export function findSameName<T extends AnyItem>(items: T[], name: string, todayISO: string): T[] {
  const needle = normalize(name);
  return items.filter((item) => {
    if (normalize(item.name) !== needle) return false;
    if (item.kind === "singleTask") return !item.done;
    return !item.endDate || item.endDate >= todayISO;
  });
}
