/**
 * Is this keydown part of an input method's composition?
 *
 * A person typing Japanese, Chinese or Korean builds each word in an
 * input method and presses Enter to CONFIRM it. That Enter reaches the
 * page as an ordinary keydown, and a composer that sends on Enter sends
 * the half-typed message. Browsers mark it with `isComposing`; some
 * engines (older Safari among them) leave that false on the confirming
 * key and report the IME's own keyCode, 229, instead, so both are read.
 *
 * Takes the native event: React's synthetic keyboard event does not
 * carry `isComposing`.
 */
export function isComposing(e: KeyboardEvent): boolean {
  return e.isComposing || e.keyCode === 229;
}
