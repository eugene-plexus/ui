import { formatDuration } from "./tasks";

/**
 * "updated 3 days ago" for catalogue rows.
 *
 * The "recently updated" sort was a list with no dates on it: the order
 * was the answer and nothing said what the order meant. Days are the
 * honest unit for a model hub — publishers push weekly, not hourly — so
 * anything under a day is "today" rather than a fake precision.
 */
export function relativeAge(
  iso: string | null | undefined,
  now: number = Date.now(),
): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const days = Math.floor((now - then) / 86_400_000);
  if (days < 0) return null;
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? "a month ago" : `${months} months ago`;
  const years = Math.floor(days / 365);
  return years <= 1 ? "a year ago" : `${years} years ago`;
}

/**
 * "in 12 min" for something that runs out: a join token, a lock, a key.
 *
 * A clock time alone ("expires 14:03") makes the reader do the
 * subtraction, and gets it wrong for anyone whose browser and machine
 * disagree about the time zone. Past instants say so rather than
 * counting up, because "in -3 min" is not a sentence.
 */
export function timeUntil(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const seconds = (then - now) / 1000;
  if (seconds <= 0) return "already passed";
  if (seconds >= 2 * 86_400) return `in ${Math.round(seconds / 86_400)} days`;
  return `in ${formatDuration(seconds)}`;
}

/**
 * "3 h ago" for something observed in the past, such as when a node last
 * answered. A future instant (clock skew between two machines) is "just
 * now" rather than a negative count.
 */
export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const seconds = (now - then) / 1000;
  if (seconds < 5) return "just now";
  if (seconds >= 2 * 86_400) return `${Math.round(seconds / 86_400)} days ago`;
  return `${formatDuration(seconds)} ago`;
}

/**
 * The time of day to the second, for "as of" beside a Refresh button: two
 * refreshes a few seconds apart must read differently, or the second
 * looks as though it did nothing.
 */
export function clockTime(when: string | number | null | undefined): string | null {
  if (when === null || when === undefined || when === "") return null;
  const then = new Date(when);
  if (Number.isNaN(then.getTime())) return null;
  return then.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * A timestamp a person can place: the time alone when it was today, the
 * date as well when it was not.
 *
 * A list covering seven days that shows `14:03` on every row cannot say
 * which Tuesday; a list covering one afternoon that repeats the date on
 * every row is noise. The locale is the browser's, as everywhere else.
 */
export function formatTimestamp(
  iso: string | null | undefined,
  now: number = Date.now(),
): string | null {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const today = new Date(now);
  const sameDay =
    then.getFullYear() === today.getFullYear() &&
    then.getMonth() === today.getMonth() &&
    then.getDate() === today.getDate();
  if (sameDay) return then.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return then.toLocaleString(undefined, {
    year: then.getFullYear() === today.getFullYear() ? undefined : "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
