"use client";

import { useEffect, useRef } from "react";

/** What the leave-anyway question says, unless a page has a better sentence. */
export const UNSAVED_CHANGES_MESSAGE = "You have changes that are not saved. Leave and lose them?";

/**
 * Ask before a page with unsaved edits is left.
 *
 * Two ways out of a page exist here and they need two guards. Closing
 * the tab, reloading or typing a new address is the browser's own
 * `beforeunload`, which shows the browser's own wording and nothing
 * else. Following a link inside the console is not a page load at all —
 * it is a client-side route change the browser never hears about, so a
 * `beforeunload` alone would guard the rare case and miss the common
 * one: clicking another object in the tree while a Config form is half
 * edited, which re-targets the editor and silently replaces the draft.
 *
 * The link guard listens on the document in the CAPTURE phase, which
 * runs before React's own click handling at the root, so declining
 * stops the navigation before the router sees it. Links that open
 * elsewhere (a new tab, a download, a modified click) leave the page
 * where it is and are not asked about, and neither is a link to the
 * page already open.
 *
 * The browser's back button is not guarded: a client-side history pop
 * cannot be cancelled without rewriting history, which is a worse
 * surprise than the one it prevents.
 */
export function useUnsavedChanges(dirty: boolean, message: string = UNSAVED_CHANGES_MESSAGE) {
  const dirtyRef = useRef(dirty);
  const messageRef = useRef(message);
  dirtyRef.current = dirty;
  messageRef.current = message;

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!dirtyRef.current) return;
      event.preventDefault();
      // Chrome still requires returnValue to be set to show the prompt.
      event.returnValue = "";
    }

    function onClick(event: MouseEvent) {
      if (!dirtyRef.current) return;
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      const next = new URL(anchor.href, window.location.href);
      const here = new URL(window.location.href);
      if (next.origin !== here.origin) return;
      if (next.pathname === here.pathname && next.search === here.search) return;
      if (window.confirm(messageRef.current)) return;
      event.preventDefault();
      event.stopPropagation();
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, []);
}
