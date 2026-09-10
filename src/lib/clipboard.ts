/**
 * Copy text to the clipboard, including where the modern API is missing.
 *
 * `navigator.clipboard` exists only in a secure context: HTTPS, or
 * localhost. The deployment this project exists to serve is a browser on a
 * tailnet talking to a plain-HTTP host, and that is *not* a secure context -
 * so on the networked setup that is differentiator #5, the obvious
 * implementation is `undefined` and a Copy button silently does nothing.
 *
 * The deprecated `execCommand("copy")` still works there. It is the fallback
 * rather than the other way round, because it is synchronous, requires a
 * live selection, and is on its way out - but "deprecated and works" beats
 * "modern and absent". Both paths can fail, and the caller is expected to
 * say so rather than pretend.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof window === "undefined" || typeof document === "undefined") return false;

  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied, or a browser that lies about isSecureContext.
      // Fall through rather than give up.
    }
  }

  try {
    const staging = document.createElement("textarea");
    staging.value = text;
    staging.setAttribute("readonly", "");
    // Off-screen but focusable: `display: none` cannot be selected, and a
    // visible element scrolls the page when focused.
    staging.style.position = "fixed";
    staging.style.top = "0";
    staging.style.left = "-9999px";
    staging.style.opacity = "0";
    document.body.appendChild(staging);

    const previous = document.getSelection()?.rangeCount
      ? document.getSelection()?.getRangeAt(0)
      : null;

    staging.select();
    staging.setSelectionRange(0, staging.value.length);
    const copied = document.execCommand("copy");

    document.body.removeChild(staging);
    // Put the operator's own selection back; copying a reply should not
    // clear the sentence they had highlighted.
    if (previous) {
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(previous);
    }
    return copied;
  } catch {
    return false;
  }
}
