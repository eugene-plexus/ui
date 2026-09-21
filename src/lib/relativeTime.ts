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
