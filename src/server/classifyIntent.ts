// Cheap, rule-based first pass that buckets a user message into the tool
// families it's likely asking for, so handleAgentRequest.ts's buildTools/
// buildSystemPrompt can send only the relevant subset instead of every tool
// on every request (see §24 in Roadmap.md). Every rule is a safe superset —
// buckets are OR'd together, never narrowed to a risky single guess — and a
// message with no confident match falls back to sending everything, i.e.
// today's exact pre-§24 behavior. This keeps the router strictly
// risk-reducing: it only narrows payload when confident. (One deliberate
// exception, §55: clearing a single field of an item — see FIELD_CLEAR_PATTERN.)

// §58: what used to be one "modify" family is three — edit (the update tools), progress
// (mark done, log an amount) and schedule (pause, resume, archive) — so that no single
// family comes near Groq's free-tier request limit.
export type IntentBucket = "create" | "delete" | "edit" | "progress" | "schedule" | "checklist";

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
// Deliberately does NOT include "mark ... done" — that phrasing means marking a
// whole item done (the "progress" bucket), not checking off one item within a
// checklist.
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
// §28: pausing/resuming, and archiving, are the "schedule" family. §59: on their own they no
// longer bring the delete tools along — "pause my gym habit" names its action plainly, and
// delete + edit together was too large for Groq's free tier.
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

// §56: "remove milk from my shopping list" / "take eggs off the list" take an item off a
// checklist, and "remove the checklist from the shopping task" takes the checklist off a
// task. Neither deletes an item, so both go to the checklist tools.
const REMOVE_FROM_LIST_PATTERN =
  /\b(?:remove|delete|erase|scrap|drop|strike|take|get rid of|cross out)\b[\s\S]*?\b(?:from|off|out of)\b[\s\S]*?\b(?:list|checklist)\b/;
const REMOVE_CHECKLIST_PATTERN =
  /\b(?:remove|delete|erase|scrap|drop|take|get rid of)\s+(?:(?:the|its|my|that|this|whole|entire)\s+)*checklist\s+(?:from|of|on|off|in)\b/;
// With one of these in the message, "list" may mean the user's tasks or habits as a whole
// ("remove the dentist task from my to-do list"), so the delete tools stay available.
const WHOLE_ITEM_WORDS = ["habit", "habits", "task", "tasks", "to-do list", "todo list"];
const REMOVAL_VERB_PATTERN = /\b(?:remove|delete|erase|scrap|drop|wipe|cancel|toss|clear|get rid of)\b/g;

const MODIFY_VERBS = ["change", "update", "edit", "rename", "adjust", "increase", "decrease", "postpone", "reschedule", "extend", "target", "goal", "shift", "swap", "tweak", "revise", "move"];
// "mark my dentist task as done" / "mark it not done" — a whole-item
// done/not-done toggle (the "progress" tools; the app finds the item whatever
// its type), not a checklist item check. The gap between "mark" and "done" is
// why this needs a regex rather than a fixed phrase.
const MARK_DONE_PATTERN = /\bmark\b[\s\S]*\b(done|not done)\b/;

// §54: placing an existing item in the day ("put reading in the evening"; "move" and
// "shift" are already edit verbs) or flagging it ("gym is a top priority").
const PLACE_IN_DAY_PATTERN =
  /\b(?:put|place)\b[\s\S]*\b(?:morning|afternoon|evening|bedtime|bed|wake-?up|work ?day|first thing|part of (?:the|my) day)\b/;
const IMPORTANCE_WORDS = ["important", "top priority", "high priority", "must-do", "priority"];

const CHECKLIST_MODE_PATTERN = /\b(?:reset|resets|carry over|carries over|same list|same checklist|every time|each time|start fresh)\b/;

// §58: change verbs that, with an amount, may be reporting progress instead of editing.
const AMOUNT_CHANGE_VERBS = ["increase", "decrease", "adjust", "update", "change"];

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
  // instead of widening, because delete + edit together is too large for Groq's free
  // tier and the phrase is unambiguous. A looser mention of a field (below) only widens.
  const clearsField = FIELD_CLEAR_PATTERN.test(text);
  const mentionsDeleteVerb = matchesAny(clearsField ? text.replace(FIELD_CLEAR_PATTERN, " ") : text, DELETE_VERBS);
  // §56: taking something off a checklist. Like §55 above, an unambiguous phrasing narrows:
  // the delete tools are left out, so the model can't delete the task instead. That needs
  // the message to ask for one removal only, of something that isn't a task or a habit;
  // any looser mix of a delete verb and a list word gets both families.
  const removesChecklist = !clearsField && REMOVE_CHECKLIST_PATTERN.test(text);
  const removesFromList = !clearsField && REMOVE_FROM_LIST_PATTERN.test(text);
  const onlyChecklistRemoval =
    (removesChecklist || (removesFromList && !matchesAny(text, WHOLE_ITEM_WORDS))) &&
    (text.match(REMOVAL_VERB_PATTERN)?.length ?? 0) <= 1;
  const hasDeleteVerb = mentionsDeleteVerb && !onlyChecklistRemoval;
  // "clear my shopping list" / "empty the list" have no delete verb of their own.
  const emptiesList = !clearsField && hasListNoun && matchesAny(text, ["clear", "empty"]);
  const touchesChecklistRemoval = removesChecklist || removesFromList || emptiesList || (mentionsDeleteVerb && hasListNoun);
  const mentionsFieldToClear =
    clearsField || TAKE_FIELD_OFF_PATTERN.test(text) || ((matchesAny(text, DELETE_VERBS) || matchesAny(text, CLEAR_ONLY_VERBS)) && matchesAny(text, FIELD_WORDS));
  const hasArchiveVerb = matchesAny(text, ARCHIVE_VERBS);
  // §54: an importance word is an edit ("make my reading habit important"), except with
  // a plainly adding verb, where it's just a field of the new item and doesn't need the
  // edit tools ("add an important task to call the bank").
  const addsNewItem = matchesAny(text, ["add", "create", "new", "schedule", "start", "begin"]) && (hasCreateNoun || hasRecurrence);
  const placesItem = PLACE_IN_DAY_PATTERN.test(text) || (matchesAny(text, IMPORTANCE_WORDS) && !addsNewItem);
  const hasEditVerb = matchesAny(text, MODIFY_VERBS) || placesItem;
  const marksDone = MARK_DONE_PATTERN.test(text);
  const hasLogVerb = matchesAny(text, LOG_VERBS);
  const hasNumberOrDuration = /\d/.test(text) || matchesAny(text, DURATION_WORDS);

  const buckets = new Set<IntentBucket>();

  // Checklist: an explicit check/uncheck verb, or an add-family verb paired
  // with a list noun (this is what routes "add milk to my shopping list" to
  // checklist rather than create — the list-noun match wins over the bare
  // presence of "add").
  if (hasCheckVerb || (hasCreateVerb && hasListNoun) || touchesChecklistRemoval) buckets.add("checklist");

  // Create: an add-family verb paired with an item-type noun or a recurrence
  // phrase — both needed, so "add milk..." above doesn't also fire this.
  if (hasCreateVerb && (hasCreateNoun || hasRecurrence)) buckets.add("create");

  // Delete: archive tools are statically bundled into this bucket's tool set
  // (see handleAgentRequest.ts's TOOL_MANIFEST) so a soft-delete phrasing
  // ("remove my old gym habit" meaning "stop tracking it") still has the
  // non-destructive tool available even though only "delete" fired here.
  if (hasDeleteVerb) buckets.add("delete");

  // Schedule: pause, resume and archive (§58/§59).
  if (hasArchiveVerb || hasPauseVerb) buckets.add("schedule");

  // Edit: the update tools — a change verb, clearing a field (§55), placing or flagging
  // (§54), or changing what a recurring task's checklist does between occurrences (§42:
  // "make the cleaning checklist reset every time", which is updateRecurringTask's job).
  const changesChecklistMode = hasListNoun && CHECKLIST_MODE_PATTERN.test(text);
  if (hasEditVerb || mentionsFieldToClear || changesChecklistMode) buckets.add("edit");

  // Progress: marking done, or logging an amount. A change verb with an amount is either
  // an edit or a log ("increase my water by 2 glasses"), so it gets both — unless it
  // names the goal, which only an edit can change.
  const amountWithChangeVerb =
    matchesAny(text, AMOUNT_CHANGE_VERBS) && hasNumberOrDuration && !matchesAny(text, ["goal", "target"]);
  if (marksDone || (hasLogVerb && hasNumberOrDuration) || amountWithChangeVerb) buckets.add("progress");

  // Safety net: a bare completion report ("I did my stretching today") with
  // no number/duration and no list/check signal is genuinely ambiguous
  // between marking a habit done ("progress") and a checklist-type habit's
  // item ("checklist") — the router can't see the user's actual data to know
  // which, so send both rather than guess.
  if (hasLogVerb && !hasNumberOrDuration && !hasListNoun && !hasCheckVerb) {
    buckets.add("progress");
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
 *   corrections): that tool's own family — the first one listed for it — since the answer
 *   re-runs the same tool. After a creation it's the edit tools instead: the follow-up
 *   corrects what was just made (plus the create tools if it has an add-type verb);
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
      return { kind: "buckets", buckets: another ? ["create", "edit"] : ["edit"], fromReply: true };
    }
    return { kind: "buckets", buckets: [buckets[0]], fromReply: true };
  }

  const asked = messages.slice(0, index).map((message) => message.role).lastIndexOf("user");
  if (asked < 0) return own;
  const earlier = classifyIntent(messages[asked].content ?? "");
  return earlier.kind === "buckets" ? { ...earlier, fromReply: true } : own;
}
