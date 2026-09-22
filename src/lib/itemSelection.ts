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

// §34 in Roadmap.md: words a user hangs off an item's name when talking about it
// ("add milk to my shopping list" for a task called "Weekly shopping", "mark my
// dentist task as done"). The model passes the whole phrase as the name, so a
// literal substring match finds nothing.
const GENERIC_WORDS = new Set([
  "a", "an", "the", "my", "our", "your", "this", "that",
  "item", "items", "list", "lists", "task", "tasks", "habit", "habits", "todo", "to-do",
]);

/**
 * §34: the name fragment with those generic words dropped, or null when that
 * wouldn't give a usable second try — nothing was dropped, or everything was
 * (so "my list" doesn't turn into a match-everything empty needle).
 */
function withoutGenericWords(needle: string): string | null {
  const words = needle.split(/\s+/);
  const kept = words.filter((word) => !GENERIC_WORDS.has(word.replace(/[^a-z0-9-]/g, "")));
  if (kept.length === 0 || kept.length === words.length) return null;
  return kept.join(" ");
}

// §35 in Roadmap.md: the user says the name in a different word form than the item
// carries ("my reading habit" for a habit called "Read", "20 minutes of meditation"
// for "Meditate"). Substring matching never lines those up, and — worse than §34 —
// a fragment like "reading" *does* literally match a different item ("Technical
// Reading"), so the wrong one was silently edited. Matching is token-based rather
// than substring here on purpose: "ready" must not match "Read".
const MIN_STEM = 3;

/**
 * A deliberately small stemmer — one suffix rule, then a trailing "e" — kept in this
 * file with no dependency. Each rule earns its place from a real phrasing; -er and -y
 * are left alone, since missing "reader" costs less than matching an unrelated item.
 */
function stem(word: string): string {
  const cut = (suffix: string, replacement = ""): string | null => {
    if (!word.endsWith(suffix)) return null;
    const stemmed = word.slice(0, -suffix.length) + replacement;
    return stemmed.length >= MIN_STEM ? stemmed : null;
  };

  let result =
    cut("sses", "ss") ?? // glasses -> glass, but glass stays glass
    cut("ies", "y") ?? // studies -> study
    (word.endsWith("ss") ? word : null) ??
    cut("s") ??
    undouble(cut("ing") ?? cut("ed")) ??
    cut("ion") ?? // meditation -> meditat, meeting "meditate" below
    cut("ment") ??
    word;
  // Applied after any rule above, so measurement -> measure -> measur matches measure.
  result = (result.endsWith("e") && result.length - 1 >= MIN_STEM ? result.slice(0, -1) : result);
  return result;
}

/** shopping -> shopp -> shop, running -> runn -> run. Not for l/s/z: call and press keep theirs. */
function undouble(word: string | null): string | null {
  if (!word) return null;
  const last = word.slice(-1);
  const doubled = word.length > MIN_STEM && word.slice(-2, -1) === last && !"lsz".includes(last);
  return doubled ? word.slice(0, -1) : word;
}

function stemTokens(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(stem);
}

/** Whether `needle`'s tokens appear as a contiguous run in `tokens` — "read" in ["technical", "read"]. */
function containsRun(tokens: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > tokens.length) return false;
  return tokens.some((_, start) => needle.every((token, offset) => tokens[start + offset] === token));
}

// How close a match is, best first. An exact name still wins outright (§34's guardrail);
// below that nothing plausible is hidden — the "which one?" list shows every match in
// this order, so the user picks rather than the app guessing (decided 2026-09-21).
const EXACT_NAME = 0;
const EXACT_WORD_FORM = 1;
const PARTIAL_NAME = 2;
const PARTIAL_WORD_FORM = 3;

function matchTier(itemName: string, needle: string, needleTokens: string[]): number | null {
  const name = normalize(itemName);
  if (name === needle) return EXACT_NAME;
  const tokens = stemTokens(itemName);
  if (tokens.length === needleTokens.length && tokens.every((token, i) => token === needleTokens[i])) {
    return EXACT_WORD_FORM;
  }
  if (name.includes(needle)) return PARTIAL_NAME;
  if (containsRun(tokens, needleTokens)) return PARTIAL_WORD_FORM;
  return null;
}

function selectByName<T extends BaseItem>(
  items: T[],
  needle: string,
  categoryId: string | undefined,
  canTakeAction: (item: T) => boolean,
): Selection<T> {
  const needleTokens = stemTokens(needle);
  let candidates = items.flatMap((item) => {
    const tier = matchTier(item.name, needle, needleTokens);
    return tier === null ? [] : [{ item, tier }];
  });
  if (categoryId) {
    candidates = candidates.filter(({ item }) => item.categoryId === categoryId);
  }
  if (candidates.length === 0) return { kind: "none" };

  const eligible = candidates.filter(({ item }) => canTakeAction(item));
  if (eligible.length === 0) return { kind: "ineligible", items: candidates.map(({ item }) => item) };

  const exact = eligible.filter(({ tier }) => tier === EXACT_NAME);
  // sort is stable, so items of the same closeness keep the order they're stored in.
  const narrowed = exact.length > 0 ? exact : [...eligible].sort((a, b) => a.tier - b.tier);
  const matched = narrowed.map(({ item }) => item);
  return matched.length === 1 ? { kind: "one", item: matched[0] } : { kind: "many", items: matched };
}

export function selectOne<T extends BaseItem>(
  items: T[],
  selector: ItemSelector,
  canTakeAction: (item: T) => boolean = () => true,
): Selection<T> {
  const needle = normalize(selector.name);
  if (!needle) return { kind: "none" };

  const selection = selectByName(items, needle, selector.categoryId, canTakeAction);
  // §34: only as a fallback, so an item genuinely called "Shopping list" still
  // wins the literal match over one called "Shopping".
  if (selection.kind !== "none") return selection;
  const relaxed = withoutGenericWords(needle);
  return relaxed ? selectByName(items, relaxed, selector.categoryId, canTakeAction) : selection;
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
