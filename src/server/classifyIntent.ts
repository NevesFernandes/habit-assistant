// Cheap, rule-based first pass that buckets a user message into the tool
// families it's likely asking for, so handleAgentRequest.ts's buildTools/
// buildSystemPrompt can send only the relevant subset instead of every tool
// on every request (see §24 in Roadmap.md). Every rule is a safe superset —
// buckets are OR'd together, never narrowed to a risky single guess — and a
// message with no confident match falls back to sending everything, i.e.
// today's exact pre-§24 behavior. This keeps the router strictly
// risk-reducing: it only narrows payload when confident.

export type IntentBucket = "create" | "delete" | "modify" | "checklist";

export type ClassifyIntentResult = { kind: "buckets"; buckets: IntentBucket[] } | { kind: "fallback" };

function escapeRegExp(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Multi-word phrases are safe to match as plain substrings (a false partial
// match needs an unlikely coincidence of adjacent words); single words get a
// word-boundary regex so e.g. "add" doesn't match inside "address".
function matchesAny(text: string, phrases: string[]): boolean {
  return phrases.some((phrase) =>
    phrase.includes(" ") ? text.includes(phrase) : new RegExp(`\\b${escapeRegExp(phrase)}\\b`).test(text),
  );
}

const LIST_NOUNS = ["list", "checklist", "shopping list", "to-do list", "todo list", "grocery list"];
// Deliberately does NOT include "mark ... done" — that phrasing means toggling
// a single task's own done/not-done field (updateSingleTask.newDone, the
// "modify" bucket), not checking off one item within a checklist.
const CHECK_VERBS = ["check off", "uncheck", "tick off", "cross off"];

const CREATE_VERBS = ["create", "add", "start", "new", "set up", "make"];
const CREATE_NOUNS = ["habit", "recurring task", "routine", "task", "reminder"];
const RECURRENCE_PATTERNS: RegExp[] = [
  /\bevery day\b/, /\bdaily\b/, /\bevery week\b/, /\bweekly\b/, /\bevery month\b/, /\bmonthly\b/,
  /\bon weekends?\b/, /\bevery\s+\d+\s+days?\b/, /\b\d+\s+times?\s+a\s+(week|month)\b/,
  /\b(first|second|third|fourth|fifth|last)\s+\w+\s+of\s+the\s+month\b/,
  /\b\d+\s+days?\s+on\b[\s\S]*\b\d+\s+days?\s+off\b/,
  /\bbirthday\b/, /\banniversary\b/,
  /\bevery\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
];

const DELETE_VERBS = ["delete", "remove", "get rid of", "erase", "clear out", "wipe"];
const ARCHIVE_VERBS = ["archive", "retire", "stop tracking", "no longer track"];

const MODIFY_VERBS = ["change", "update", "edit", "rename", "adjust", "increase", "decrease", "postpone", "reschedule", "extend", "target", "goal"];
// "mark my dentist task as done" / "mark it not done" — a whole-item
// done/not-done toggle, handled by updateSingleTask.newDone, not a checklist
// item check. The gap between "mark" and "done" is why this needs a regex
// rather than a fixed phrase in MODIFY_VERBS.
const MARK_DONE_PATTERN = /\bmark\b[\s\S]*\b(done|not done)\b/;

const LOG_VERBS = ["log", "logged", "record", "recorded", "did", "drank", "read for", "walked", "ran", "meditated", "finished", "completed", "done with"];
const DURATION_WORDS = ["minute", "minutes", "hour", "hours", "glass", "glasses", "page", "pages", "rep", "reps", "mile", "miles", "step", "steps", "cup", "cups", "time", "times"];

export function classifyIntent(rawText: string): ClassifyIntentResult {
  const text = rawText.toLowerCase();

  const hasCheckVerb = matchesAny(text, CHECK_VERBS);
  const hasListNoun = matchesAny(text, LIST_NOUNS);
  const hasCreateVerb = matchesAny(text, CREATE_VERBS);
  const hasCreateNoun = matchesAny(text, CREATE_NOUNS);
  const hasRecurrence = RECURRENCE_PATTERNS.some((pattern) => pattern.test(text));
  const hasDeleteVerb = matchesAny(text, DELETE_VERBS);
  const hasArchiveVerb = matchesAny(text, ARCHIVE_VERBS);
  const hasModifyVerb = matchesAny(text, MODIFY_VERBS) || MARK_DONE_PATTERN.test(text);
  const hasLogVerb = matchesAny(text, LOG_VERBS);
  const hasNumberOrDuration = /\d/.test(text) || matchesAny(text, DURATION_WORDS);

  const buckets = new Set<IntentBucket>();

  // Checklist: an explicit check/uncheck verb, or an add-family verb paired
  // with a list noun (this is what routes "add milk to my shopping list" to
  // checklist rather than create — the list-noun match wins over the bare
  // presence of "add").
  if (hasCheckVerb || (hasCreateVerb && hasListNoun)) buckets.add("checklist");

  // Create: an add-family verb paired with an item-type noun or a recurrence
  // phrase — both needed, so "add milk..." above doesn't also fire this.
  if (hasCreateVerb && (hasCreateNoun || hasRecurrence)) buckets.add("create");

  // Delete: archive tools are statically bundled into this bucket's tool set
  // (see handleAgentRequest.ts's BUCKET_TOOL_NAMES) so a soft-delete phrasing
  // ("remove my old gym habit" meaning "stop tracking it") still has the
  // non-destructive tool available even though only "delete" fired here.
  if (hasDeleteVerb || hasArchiveVerb) buckets.add("delete");

  // Modify: update/archive/log-with-amount all live in one merged bucket
  // (see Roadmap.md §24) because the system prompt cross-references them
  // pairwise — splitting them would require conditionally rewriting that
  // prose, which is exactly the kind of routing-induced fragility to avoid.
  if (hasModifyVerb || hasArchiveVerb || (hasLogVerb && hasNumberOrDuration)) buckets.add("modify");

  // Safety net: a bare completion report ("I did my stretching today") with
  // no number/duration and no list/check signal is genuinely ambiguous
  // between a Numeric/Timer habit (logHabitProgress, "modify") and a
  // checklist-type habit's item ("checklist") — the router can't see the
  // user's actual data to know which, so send both rather than guess.
  if (hasLogVerb && !hasNumberOrDuration && !hasListNoun && !hasCheckVerb) {
    buckets.add("modify");
    buckets.add("checklist");
  }

  if (buckets.size === 0) return { kind: "fallback" };
  return { kind: "buckets", buckets: Array.from(buckets) };
}
