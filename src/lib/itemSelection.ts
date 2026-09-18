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

const ORDINALS: Record<string, number> = {
  first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4, fifth: 5, "5th": 5,
  sixth: 6, "6th": 6, seventh: 7, "7th": 7, eighth: 8, "8th": 8, ninth: 9, "9th": 9, tenth: 10, "10th": 10,
};
const PICK_PATTERN =
  /^(?:the\s+)?(?:number\s+|no\.?\s*|#\s*|option\s+)?(\d+|[a-z0-9]+|last)(?:\s+one)?(?:\s+please)?[.!]?$/;

/**
 * Reads a reply to the numbered "which one did you mean?" list as a 1-based
 * pick — "2", "#2", "number 2", "the second one", "last". `count` is the
 * list length, needed for "last". Returns null for anything else (so it goes
 * to the model as a normal message); an out-of-range number is still
 * returned, for the caller to reject.
 */
export function parsePick(text: string, count: number): number | null {
  const match = PICK_PATTERN.exec(text.trim().toLowerCase());
  if (!match) return null;
  const token = match[1];
  if (token === "last") return count;
  if (/^\d+$/.test(token)) return Number(token);
  return ORDINALS[token] ?? null;
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
