// Cheap, rule-based first pass that buckets a user message into the tool
// families it's likely asking for, so handleAgentRequest.ts's buildTools/
// buildSystemPrompt can send only the relevant subset instead of every tool
// on every request (see §24 in Roadmap.md). Every rule is a safe superset —
// buckets are OR'd together, never narrowed to a risky single guess — and a
// message with no confident match falls back to sending everything, i.e.
// today's exact pre-§24 behavior. This keeps the router strictly
// risk-reducing: it only narrows payload when confident. (One deliberate
// exception, §55: clearing a single field of an item — see FIELD_CLEAR_PATTERN.)

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

const CREATE_VERBS = ["create", "add", "start", "new", "set up", "make", "schedule", "begin"];
const CREATE_NOUNS = ["habit", "recurring task", "routine", "task", "reminder"];
const RECURRENCE_PATTERNS: RegExp[] = [
  /\bevery day\b/, /\bdaily\b/, /\bevery week\b/, /\bweekly\b/, /\bevery month\b/, /\bmonthly\b/,
  /\bon weekends?\b/, /\bevery\s+\d+\s+days?\b/, /\b\d+\s+times?\s+a\s+(week|month)\b/,
  /\b(first|second|third|fourth|fifth|last)\s+\w+\s+of\s+the\s+month\b/,
  /\b\d+\s+days?\s+on\b[\s\S]*\b\d+\s+days?\s+off\b/,
  /\bbirthday\b/, /\banniversary\b/,
  /\bevery\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
];

const DELETE_VERBS = ["delete", "remove", "get rid of", "erase", "clear out", "wipe", "cancel", "toss", "scrap"];
const ARCHIVE_VERBS = ["archive", "retire", "stop tracking", "no longer track"];
// §28: pausing/resuming. Both directions live in "modify"; pausing also joins "delete"
// (below) because "stop my gym habit for two weeks" is a soft-stop phrasing that must
// not be left with only the destructive tools in its payload.
const PAUSE_VERBS = ["pause", "unpause", "suspend", "on hold", "take a break", "taking a break", "hold off", "resume", "start it again", "start tracking it again"];

// §55: "remove the comments of the task X" / "clear the end date on gym" take one *field*
// off an item — an edit (updateX with that field set to ""), not a deletion. Users say
// notes/comments/details for the description.
const FIELD_WORDS = ["description", "descriptions", "note", "notes", "comment", "comments", "details", "end date", "deadline", "category", "priority"];
const CLEAR_ONLY_VERBS = ["clear", "drop", "take off", "take away", "unset"];
// The field is the verb's own object, and then the sentence ends or names the item it
// belongs to: "remove the notes from …", "delete the description of …", "clear the end
// date". Not "delete the notes task" or "remove my Finance category tasks", where the word
// only describes which items to delete.
const FIELD_CLEAR_PATTERN = new RegExp(
  "\\b(?:remove|delete|erase|wipe|scrap|cancel|get rid of|clear out|clear|drop|take off|take away|unset)\\s+" +
    "(?:(?:the|its|their|my|that|this|all|any)\\s+)*" +
    "(?:descriptions?|notes?|comments?|details|end date|deadline|category|priority)" +
    "(?:\\s+(?:from|of|on|for|in)\\b|[\\s.!?]*$)",
);
// "take the category off my shopping task" — the same request with the verb split in two.
const TAKE_FIELD_OFF_PATTERN =
  /\btake\s+(?:(?:the|its|their|my|that|this)\s+)*(?:descriptions?|notes?|comments?|details|end date|deadline|category|priority)\s+(?:off|away)\b/;

const MODIFY_VERBS = ["change", "update", "edit", "rename", "adjust", "increase", "decrease", "postpone", "reschedule", "extend", "target", "goal", "shift", "swap", "tweak", "revise", "move"];
// "mark my dentist task as done" / "mark it not done" — a whole-item
// done/not-done toggle, handled by updateSingleTask.newDone, not a checklist
// item check. The gap between "mark" and "done" is why this needs a regex
// rather than a fixed phrase in MODIFY_VERBS.
const MARK_DONE_PATTERN = /\bmark\b[\s\S]*\b(done|not done)\b/;

const LOG_VERBS = ["log", "logged", "record", "recorded", "did", "drank", "read for", "walked", "ran", "meditated", "finished", "completed", "done with", "practiced", "studied", "tracked"];
const DURATION_WORDS = ["minute", "minutes", "hour", "hours", "glass", "glasses", "page", "pages", "rep", "reps", "mile", "miles", "step", "steps", "cup", "cups", "time", "times"];

export function classifyIntent(rawText: string): ClassifyIntentResult {
  const text = rawText.toLowerCase();

  const hasCheckVerb = matchesAny(text, CHECK_VERBS);
  const hasPauseVerb = matchesAny(text, PAUSE_VERBS);
  const hasListNoun = matchesAny(text, LIST_NOUNS);
  const hasCreateVerb = matchesAny(text, CREATE_VERBS);
  const hasCreateNoun = matchesAny(text, CREATE_NOUNS);
  const hasRecurrence = RECURRENCE_PATTERNS.some((pattern) => pattern.test(text));
  // §55: with a field-clearing phrase taken out, is anything still asking to delete? If
  // not, the delete tools stay out of the payload — this is the one rule here that narrows
  // instead of widening, because delete + modify together is too large for Groq's free
  // tier and the phrase is unambiguous. A looser mention of a field (below) only widens.
  const clearsField = FIELD_CLEAR_PATTERN.test(text);
  const hasDeleteVerb = matchesAny(clearsField ? text.replace(FIELD_CLEAR_PATTERN, " ") : text, DELETE_VERBS);
  const mentionsFieldToClear =
    clearsField || TAKE_FIELD_OFF_PATTERN.test(text) || ((matchesAny(text, DELETE_VERBS) || matchesAny(text, CLEAR_ONLY_VERBS)) && matchesAny(text, FIELD_WORDS));
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
  if (hasDeleteVerb || hasArchiveVerb || hasPauseVerb) buckets.add("delete");

  // Modify: update/archive/log-with-amount all live in one merged bucket
  // (see Roadmap.md §24) because the system prompt cross-references them
  // pairwise — splitting them would require conditionally rewriting that
  // prose, which is exactly the kind of routing-induced fragility to avoid.
  if (hasModifyVerb || hasArchiveVerb || hasPauseVerb || mentionsFieldToClear || (hasLogVerb && hasNumberOrDuration)) buckets.add("modify");

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

// §51: a short answer to a question ("the one in Nutrition", "no, only on weekdays",
// "10 glasses") carries no action words of its own, so on its own it would fall back to
// every tool — a payload too large for Groq's free tier. What it answers says which tools
// it needs.
interface TurnMessage {
  role: "user" | "assistant" | "tool";
  content?: string;
  toolCall?: { name: string };
}

export type ClassifyTurnResult = ClassifyIntentResult & { fromReply?: true };

// Longer than this, an unclassified message is more likely a new request the rules above
// missed than an answer to a question, and gets every tool as before.
const REPLY_MAX_WORDS = 8;

/**
 * Classifies the latest user message; when it has no confident bucket of its own and is
 * short, falls back to what the assistant said just before it:
 * - an app reply to a tool call (a "which one?" list, or a confirmation inviting
 *   corrections): the tools that edit an existing item — after a creation too, since the
 *   follow-up corrects what was just made (plus the create tools if it has an add-type
 *   verb) — or that tool's own buckets if it isn't an editing one;
 * - the model's own question: whatever the user's previous message needed, since that
 *   request is still being answered.
 * `bucketsOfTool` is handleAgentRequest.ts's manifest lookup, passed in to keep this file
 * free of the tool list.
 */
export function classifyTurn(
  messages: TurnMessage[],
  bucketsOfTool: (toolName: string) => IntentBucket[] | undefined,
): ClassifyTurnResult {
  const latestIndex = messages.map((message) => message.role).lastIndexOf("user");
  const latest = messages[latestIndex]?.content ?? "";
  const own = classifyIntent(latest);
  if (own.kind === "buckets") return own;

  const words = latest.trim().split(/\s+/).filter((word) => word.length > 0).length;
  if (words === 0 || words > REPLY_MAX_WORDS) return own;

  let index = latestIndex - 1;
  while (index >= 0 && messages[index].role === "tool") index--;
  const previous = messages[index];
  if (!previous || previous.role !== "assistant") return own;

  if (previous.toolCall) {
    const buckets = bucketsOfTool(previous.toolCall.name);
    if (!buckets || buckets.length === 0) return own;
    if (buckets.includes("create")) {
      // Usually a correction ("no, only on weekdays"), but an add-type verb may be asking
      // for one more ("add another for evenings"), so keep the create tools for that.
      const another = matchesAny(latest.toLowerCase(), CREATE_VERBS);
      return { kind: "buckets", buckets: another ? ["create", "modify"] : ["modify"], fromReply: true };
    }
    return { kind: "buckets", buckets: buckets.includes("modify") ? ["modify"] : buckets, fromReply: true };
  }

  const asked = messages.slice(0, index).map((message) => message.role).lastIndexOf("user");
  if (asked < 0) return own;
  const earlier = classifyIntent(messages[asked].content ?? "");
  return earlier.kind === "buckets" ? { ...earlier, fromReply: true } : own;
}
