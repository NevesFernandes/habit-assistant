// §76: a set of items made for this user in one go ("set me up a morning routine", "help me
// get fit for a 10K"), for the app's chat and the Claude connector alike. There are no
// templates: the model builds the set from what the user said, so one person's morning
// routine can differ from another's. The app checks each item with the same rules as a
// single create, leaves out what the user already has, shows the list and adds nothing
// before a yes ("yes, without 2" trims it). Pure: no Drive, no model.
import type { AppData, CompletionType, DayPart, RecurrenceRule } from "../types/models.ts";
import { addHabit, addRecurringTask, addSingleTask, resolveCategoryId } from "./dataStore.ts";
import { describeRecurrence } from "./recurrence.ts";
import { dayPartLabel, isDayPart } from "./dayParts.ts";
import { findSameName, selectOne } from "./itemSelection.ts";
import { formatDate } from "./confirmations.ts";

/** Most items one pack adds, so the list stays readable and the request small. */
export const PACK_MAX_ITEMS = 10;

/** One proposed item, its recurrence already parsed (the app's server and the connector parse the compact form). */
export interface PackItem {
  kind: "habit" | "recurringTask" | "singleTask";
  name: string;
  description?: string;
  categoryId?: string;
  dayPart?: DayPart;
  recurrence?: RecurrenceRule;
  completionType?: CompletionType;
  target?: number;
  unit?: string;
  checklistItems?: string[];
}

export interface PackPlan {
  packName: string;
  startDate?: string;
  /** What a yes adds, in the order proposed. */
  items: PackItem[];
  /** Proposed, but the user already has one by that name. */
  existing: string[];
  /** Proposed, but not addable as given. */
  dropped: { name: string; reason: string }[];
}

const KIND_LABELS = { habit: "habit", recurringTask: "recurring task", singleTask: "one-off task" } as const;

function steps(texts: string[] | undefined): string[] {
  return (texts ?? []).map((text) => text.trim()).filter((text) => text.length > 0);
}

/** Why an item can't be added as given, or undefined; the rules of a single create (§31). */
function invalidReason(item: PackItem): string | undefined {
  if (!item.name?.trim()) return "no name";
  if (item.kind !== "singleTask" && !item.recurrence) return "no schedule";
  if (item.kind === "habit") {
    const type = item.completionType ?? "yesno";
    if ((type === "value" || type === "timer") && !(item.target && item.target > 0)) return "no goal amount";
    if (type === "checklist" && steps(item.checklistItems).length === 0) return "no steps";
  }
  return undefined;
}

/** The pack as it would be added: checked, trimmed to PACK_MAX_ITEMS, without what the user already has. */
export function planPack(data: AppData, packName: string, proposed: PackItem[], today: string, startDate?: string): PackPlan {
  const items: PackItem[] = [];
  const existing: string[] = [];
  const dropped: { name: string; reason: string }[] = [];
  for (const item of proposed) {
    const name = item.name?.trim() ?? "";
    const reason = invalidReason(item);
    if (reason) dropped.push({ name: name || "(unnamed)", reason });
    else if (findSameName([...data.habits, ...data.recurringTasks, ...data.singleTasks], name, today).length > 0) existing.push(name);
    else if (items.some((other) => other.name.trim().toLowerCase() === name.toLowerCase())) continue;
    else if (items.length >= PACK_MAX_ITEMS) dropped.push({ name, reason: `over the ${PACK_MAX_ITEMS}-item limit` });
    else items.push({ ...item, name, dayPart: isDayPart(item.dayPart) ? item.dayPart : undefined });
  }
  return { packName: packName.trim() || "your set", ...(startDate && startDate > today ? { startDate } : {}), items, existing, dropped };
}

function detail(item: PackItem): string {
  const bits: string[] = [KIND_LABELS[item.kind]];
  if (item.recurrence) bits.push(describeRecurrence(item.recurrence).toLowerCase());
  if (item.kind === "habit") {
    if (item.completionType === "value") bits.push(`${item.target}${item.unit ? ` ${item.unit}` : ""}`);
    if (item.completionType === "timer") bits.push(`${item.target} min`);
    if (item.completionType === "checklist") bits.push(steps(item.checklistItems).join(", "));
  }
  if (item.dayPart) bits.push(dayPartLabel(item.dayPart));
  return bits.join(", ");
}

/** The question shown before anything is added. */
export function describePackPreview(plan: PackPlan, today: string): string {
  const lines: string[] = [];
  if (plan.items.length === 0) {
    lines.push(`I couldn't put together anything new for ${plan.packName}.`);
  } else {
    const when = plan.startDate ? `, starting ${formatDate(plan.startDate, today)}` : "";
    lines.push(`Here's ${plan.packName} (${plan.items.length} ${plan.items.length === 1 ? "item" : "items"}${when}):`);
    lines.push(...plan.items.map((item, index) => `${index + 1}. ${item.name}: ${detail(item)}`));
  }
  if (plan.existing.length) lines.push(`Already have: ${plan.existing.join(", ")} (left out).`);
  if (plan.dropped.length) lines.push(`Couldn't add: ${plan.dropped.map((d) => `${d.name} (${d.reason})`).join(", ")}.`);
  if (plan.items.length) lines.push(`Add ${plan.items.length === 1 ? "it" : `these ${plan.items.length}`}? You can also say which to leave out, like "yes, without 2".`);
  return lines.join("\n");
}

/** "yes, without 2 and the cold shower": by number in the list or by name. Unmatched words are ignored. */
export function withoutItems(plan: PackPlan, leaveOut: string[] | undefined): PackPlan {
  if (!leaveOut?.length) return plan;
  const out = new Set<number>();
  for (const raw of leaveOut) {
    const text = raw.trim();
    const number = Number(text.replace(/^#/, ""));
    if (Number.isInteger(number) && number >= 1 && number <= plan.items.length) {
      out.add(number - 1);
      continue;
    }
    const pick = selectOne(plan.items.map((item, index) => ({ ...item, id: String(index), startDate: "" })), { name: text });
    if (pick.kind === "one") out.add(Number(pick.item.id));
  }
  return { ...plan, items: plan.items.filter((_, index) => !out.has(index)) };
}

/** Adds every item of the plan, in order. */
export function applyPack(data: AppData, plan: PackPlan, today: string): AppData {
  return plan.items.reduce((next, item) => {
    const base = { name: item.name, description: item.description?.trim() || undefined, dayPart: item.dayPart, startDate: plan.startDate };
    if (item.kind === "habit") {
      return addHabit(
        next,
        {
          ...base,
          categoryId: resolveCategoryId(next, item.categoryId) ?? "other",
          recurrence: item.recurrence!,
          completionType: item.completionType,
          target: item.target,
          unit: item.unit,
          checklistItems: item.completionType === "checklist" ? steps(item.checklistItems) : undefined,
        },
        today,
      );
    }
    if (item.kind === "recurringTask") {
      return addRecurringTask(next, { ...base, categoryId: resolveCategoryId(next, item.categoryId), recurrence: item.recurrence! }, today);
    }
    return addSingleTask(next, { ...base, categoryId: resolveCategoryId(next, item.categoryId) }, today);
  }, data);
}

/** The reply once added. */
export function describePackAdded(plan: PackPlan, today: string): string {
  if (plan.items.length === 0) return "Nothing left to add, so I didn't add anything.";
  const when = plan.startDate ? `They start ${formatDate(plan.startDate, today)}.` : "They start today.";
  return `Added ${plan.packName}: ${plan.items.map((item) => item.name).join(", ")}. ${when} Change any of them by asking, like "move ${plan.items[0].name} to the evening".`;
}
