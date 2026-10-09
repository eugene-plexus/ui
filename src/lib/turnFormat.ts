/**
 * How one playground turn is put into numbers, in one place.
 *
 * The same turn used to read three ways: the bar said `2.5s`, the report
 * `2610 ms total`, and the first token was "first token" in one and
 * "first frame" in the other, with the window as `32,768` beside
 * `32768`. Each was right; together they looked like three different
 * measurements. The bar and the report both spell through these now.
 */

/** A duration, in seconds to two decimals. */
export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)} s`;
}

/** A token count, grouped the same way whatever the browser's locale. */
export function tokenCount(count: number): string {
  return count.toLocaleString("en-US");
}
