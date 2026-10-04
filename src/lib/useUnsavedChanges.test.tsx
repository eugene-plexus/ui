/**
 * Which clicks the leave guard asks about. The pages that use it (Config,
 * Routing) prove the wiring; this pins the edges, where asking would be
 * an annoyance and not asking would lose work.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useUnsavedChanges } from "./useUnsavedChanges";

function Page({ dirty }: { dirty: boolean }) {
  useUnsavedChanges(dirty);
  const route = (e: React.MouseEvent) => e.preventDefault();
  return (
    <>
      <a href="/library/" onClick={route}>
        elsewhere
      </a>
      <a href={window.location.pathname + window.location.search} onClick={route}>
        here
      </a>
      <a href="/library/" target="_blank" onClick={route}>
        new tab
      </a>
    </>
  );
}

afterEach(() => vi.restoreAllMocks());

describe("useUnsavedChanges", () => {
  it("asks about a link elsewhere only while there is something to lose", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { rerender } = render(<Page dirty={false} />);
    fireEvent.click(screen.getByText("elsewhere"));
    expect(confirm).not.toHaveBeenCalled();
    rerender(<Page dirty />);
    fireEvent.click(screen.getByText("elsewhere"));
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("does not ask about a new tab, a modified click, or the page already open", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Page dirty />);
    fireEvent.click(screen.getByText("new tab"));
    fireEvent.click(screen.getByText("elsewhere"), { ctrlKey: true });
    fireEvent.click(screen.getByText("here"));
    expect(confirm).not.toHaveBeenCalled();
  });

  it("stops listening once the page is gone", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { unmount } = render(<Page dirty />);
    unmount();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });
});
