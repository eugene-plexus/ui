/**
 * The clipboard fallback, which is the path every tailnet install takes:
 * a plain-HTTP page is not a secure context, so `navigator.clipboard` is
 * absent and `execCommand("copy")` does the work.
 */

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { copyText } from "./clipboard";

beforeEach(() => {
  vi.stubGlobal("isSecureContext", false);
  // jsdom has no execCommand; the browsers this runs in do.
  document.execCommand = vi.fn(() => true);
  // jsdom's select() does not move focus. Chromium's does, which is the
  // behaviour the fallback has to undo.
  vi.spyOn(HTMLTextAreaElement.prototype, "select").mockImplementation(function (
    this: HTMLTextAreaElement,
  ) {
    this.focus();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

it("copies through the fallback when there is no secure context", async () => {
  expect(await copyText("http://192.168.16.252:8280/v1")).toBe(true);
  expect(document.execCommand).toHaveBeenCalledWith("copy");
});

it("leaves keyboard focus on the button that asked, not on the page", async () => {
  const button = document.createElement("button");
  button.textContent = "Copy";
  document.body.appendChild(button);
  button.focus();
  await copyText("a key");
  expect(document.activeElement).toBe(button);
});
