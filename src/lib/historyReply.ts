// §66: the app chat's reply to a history question, built from getHistory's result the same
// way confirmations.ts builds the other replies: plain text, one line per item, in the
// day's order. The Claude connector returns the History itself and lets Claude word it.
import type { History, HistoryItemSummary, HistoryStatus } from "./history.ts";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Past this many, dates are counted instead of listed. */
const MAX_LISTED_DATES = 4;

function parts(dateISO: string) {
  const [y, m, d] = dateISO.split("-").map(Number);
  return { y, m, d, weekday: WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] };
}

/** "Mon 15 Sep", with the year only when it isn't today's. */
export function shortDate(dateISO: string, todayISO: string): string {
  const { y, m, d, weekday } = parts(dateISO);
  return `${weekday} ${d} ${MONTHS[m - 1]}${dateISO.slice(0, 4) === todayISO.slice(0, 4) ? "" : ` ${y}`}`;
}

function datesWith(history: History, id: string, status: HistoryStatus): string[] {
  return (history.days ?? []).flatMap((day) => (day.items.some((item) => item.id === id && item.status === status) ? [day.date] : []));
}

/** "missed Mon 15, Thu 18" — or "missed 6 days" when there are more, or no day list. */
function listed(label: string, dates: string[], count: number, today: string): string {
  if (count === 0) return "";
  if (dates.length === 0 || count > MAX_LISTED_DATES) return `${label} ${count} ${count === 1 ? "day" : "days"}`;
  return `${label} ${dates.map((date) => shortDate(date, today)).join(", ")}`;
}

function periodLine(item: HistoryItemSummary, today: string, period: "week" | "month"): string {
  const bits = (item.periods ?? []).map((p) => {
    const { m } = parts(p.start);
    const when = period === "week" ? `the week of ${shortDate(p.start, today).slice(4)}` : MONTHS[m - 1];
    return `${p.done} of ${p.target} in ${when}`;
  });
  return `${item.name}: ${bits.join(", ")}`;
}

function itemLine(history: History, item: HistoryItemSummary, today: string, flexible?: "week" | "month"): string {
  if (flexible) return periodLine(item, today, flexible);
  if (item.kind === "singleTask") {
    const status = (history.days ?? []).flatMap((day) =>
      day.items.filter((i) => i.id === item.id && i.status !== "not_due").map((i) => ({ date: day.date, status: i.status })),
    )[0];
    if (!status) return `${item.name}: ${item.done ? "done" : item.missed ? "not done" : "still to do"}`;
    const when = shortDate(status.date, today);
    if (status.status === "done") return `${item.name}: done (${when})`;
    if (status.status === "missed") return `${item.name}: not done (${when})`;
    if (status.status === "open") return `${item.name}: still to do today`;
    return `${item.name}: due ${when}`;
  }
  const bits: string[] = [];
  const past = item.done + item.missed;
  if (past > 0) bits.push(`${item.done} of ${past} done`);
  const missed = listed("missed", datesWith(history, item.id, "missed"), item.missed, today);
  if (missed) bits.push(missed);
  if (item.due > past) bits.push("today still to do");
  const paused = listed("paused", datesWith(history, item.id, "paused"), item.paused, today);
  if (paused) bits.push(paused);
  // Days ahead are listed only when there are one or two; otherwise counted.
  if (item.upcoming > 2) bits.push(`due ${item.upcoming} more days`);
  else if (item.upcoming > 0) bits.push(listed("due", datesWith(history, item.id, "upcoming"), item.upcoming, today));
  return `${item.name}: ${bits.join(", ")}`;
}

/** §67: the item's notes in the range, one indented line each, oldest first. */
function noteLines(history: History, id: string, today: string): string[] {
  return (history.days ?? []).flatMap((day) =>
    day.items.filter((i) => i.id === id && i.note).map((i) => `  ${shortDate(day.date, today)}: "${i.note}"`),
  );
}

function itemBlock(history: History, item: HistoryItemSummary, today: string, flexible?: "week" | "month"): string[] {
  const line = itemLine(history, item, today, flexible);
  // An item with only notes in the range has no counts to show.
  const counted = !/: $/.test(line);
  return [...(counted ? [line] : [`${item.name}:`]), ...noteLines(history, item.id, today)];
}

/**
 * The reply. `flexibleOf` says which items are "N times a week/month" (their line reads per
 * period); `single` is set when the user asked about one item, which adds when it was last done.
 */
export function describeHistory(
  history: History,
  flexibleOf: (id: string) => "week" | "month" | undefined,
  single?: { name: string },
): string {
  const { from, to, today } = history;
  const range = from === to ? shortDate(from, today) : `${shortDate(from, today)} to ${shortDate(to, today)}`;
  const within = from === to ? `on ${range}` : `between ${shortDate(from, today)} and ${shortDate(to, today)}`;
  if (single) {
    const item = history.items[0];
    const last = item?.lastDone ? `Last done ${shortDate(item.lastDone, today)}.` : "Not done yet.";
    const nothing = item && item.due === 0 && item.upcoming === 0 && item.paused === 0 && !item.periods?.length;
    if (!item || (nothing && noteLines(history, item.id, today).length === 0)) {
      return `"${single.name}" wasn't due ${within}. ${last}`;
    }
    return [range, ...itemBlock(history, item, today, flexibleOf(item.id)), last].join("\n");
  }
  if (history.items.length === 0) return `Nothing was due ${within}.`;
  return [range, ...history.items.flatMap((item) => itemBlock(history, item, today, flexibleOf(item.id)))].join("\n");
}
